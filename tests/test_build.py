"""build.py(엑셀 읽기·HTML 조립) 점검. 사용법: python tests/test_build.py"""
import importlib.util, json, os, re, subprocess, sys, tempfile, unittest, datetime as dt

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('build', os.path.join(ROOT, 'tools', 'build.py'))
build = importlib.util.module_from_spec(spec); spec.loader.exec_module(build)
SAMPLE = os.path.join(ROOT, 'sample', 'SG지급_자료수집_샘플.xlsx')


def copy_modified(fn):
    wb = openpyxl.load_workbook(SAMPLE)
    fn(wb)
    d = tempfile.mkdtemp(); p = os.path.join(d, 'x.xlsx'); wb.save(p)
    return p


class Parse(unittest.TestCase):
    def test_sample_rows(self):
        data = build.build_data([SAMPLE], True, '2026-11-17')
        self.assertEqual(len(data['payments']), 117); self.assertEqual(len(data['prebuy']), 24)
        self.assertTrue(data['meta']['synthetic']); self.assertEqual(data['meta']['config']['yearEnd'], '2026-12-31')
        self.assertEqual(data['meta']['config']['deadlines'], {'finance': '2026-11-16', 'scm': '2026-11-17', 'approval': '2026-11-20'})
        self.assertEqual(data['meta']['parseIssues'], [])

    def test_values_are_typed(self):
        data = build.build_data([SAMPLE], True, '2026-11-17')
        h = data['prebuy'][0]
        self.assertIsInstance(h['ledger'], (int, float)); self.assertRegex(h['asOf'], r'^\d{4}-\d{2}-\d{2}$'); self.assertIn(h['country'], ('KR', 'JP', 'VN'))
        p = data['payments'][0]
        self.assertIsInstance(p['avg'], (int, float)); self.assertIn(p['ccy'], ('KRW', 'VND', 'THB', 'HKD', 'TWD', 'MYR', 'MOP'))

    def test_excel_formulas_are_not_used(self):
        data = build.build_data([SAMPLE], True, '2026-11-17')
        self.assertTrue(all(r['months'] is None and r['est'] is None for r in data['prebuy']), '수식 열은 캐시가 없어 비어 있다(값은 화면에서 다시 계산한다)')

    def test_extra_column_in_front_does_not_matter(self):
        def f(wb):
            wb['②프리바이목록'].insert_cols(1)       # 앞에 빈 열을 끼워 모든 열을 한 칸 민다
        base = build.build_data([SAMPLE], True, '2026-11-17')['prebuy']
        moved = build.build_data([copy_modified(f)], True, '2026-11-17')['prebuy']
        self.assertEqual([{k: v for k, v in r.items() if k != 'file'} for r in moved], [{k: v for k, v in r.items() if k != 'file'} for r in base])

    def test_swapped_columns_are_found_by_header(self):
        def f(wb):
            ws = wb['①지급목록']
            for r in range(4, ws.max_row + 1):                          # I열(카드)과 J열(계좌)을 머리글째로 맞바꾼다
                a, b = ws.cell(row=r, column=9).value, ws.cell(row=r, column=10).value
                ws.cell(row=r, column=9).value, ws.cell(row=r, column=10).value = b, a
        base = build.build_data([SAMPLE], True, '2026-11-17')['payments']
        swapped = build.build_data([copy_modified(f)], True, '2026-11-17')['payments']
        self.assertEqual([(p['card'], p['account']) for p in swapped], [(p['card'], p['account']) for p in base])

    def test_answers_are_normalized(self):
        def f(wb):
            ws = wb['①지급목록']
            ws['I5'] = 'o'; ws['I6'] = '불가'; ws['I7'] = '모름'; ws['I8'] = '가나다'; ws['H5'] = '1,234,567'; ws['H6'] = 'abc'
        data = build.build_data([copy_modified(f)], True, '2026-11-17')
        p = data['payments']
        self.assertEqual(p[0]['card'], 'O'); self.assertEqual(p[1]['card'], 'X'); self.assertEqual(p[2]['card'], '미확인'); self.assertIsNone(p[3]['card']); self.assertEqual(p[0]['avg'], 1234567); self.assertIsNone(p[1]['avg'])
        fields = {(i['row'], i['field']) for i in data['meta']['parseIssues']}
        self.assertIn((8, 'card'), fields); self.assertIn((6, 'avg'), fields)

    def test_dates(self):
        def f(wb):
            ws = wb['②프리바이목록']; ws['I5'] = '2026/11/03'; ws['I6'] = dt.datetime(2026, 11, 4, 10, 30); ws['I7'] = '어제'
        data = build.build_data([copy_modified(f)], True, '2026-11-17')
        self.assertEqual(data['prebuy'][0]['asOf'], '2026-11-03'); self.assertEqual(data['prebuy'][1]['asOf'], '2026-11-04'); self.assertIsNone(data['prebuy'][2]['asOf'])
        self.assertTrue(any(i.get('field') == 'asOf' and i.get('row') == 7 for i in data['meta']['parseIssues']))

    def test_missing_required_column_stops(self):
        def f(wb):
            ws = wb['②프리바이목록']; ws['G4'] = '엉뚱한 제목'
        with self.assertRaises(SystemExit) as cm:
            build.build_data([copy_modified(f)], True, '2026-11-17')
        self.assertIn('ledger', str(cm.exception))

    def test_two_files_are_merged(self):
        data = build.build_data([SAMPLE, SAMPLE], True, '2026-11-17')
        self.assertEqual(len(data['payments']), 234); self.assertEqual(len(data['prebuy']), 48); self.assertEqual(len(data['meta']['sources']), 2)

    def test_empty_rows_are_skipped(self):
        def f(wb):
            wb['①지급목록'].cell(row=300, column=3, value=None)
        self.assertEqual(len(build.build_data([copy_modified(f)], True, '2026-11-17')['payments']), 117)


class Assemble(unittest.TestCase):
    def test_html_contains_data_and_no_markers(self):
        html = build.assemble(build.build_data([SAMPLE], True, '2026-11-17'))
        for m in ('/*__STYLE__*/', '/*__SCRIPT__*/', '/*__DATA__*/'):
            self.assertNotIn(m, html)
        self.assertIn('"synthetic":true', html); self.assertIn('Content-Security-Policy', html)

    def test_script_close_tag_in_data_is_escaped(self):
        def f(wb):
            wb['②프리바이목록']['C5'] = 'x</script><script>alert(1)</script>'
        html = build.assemble(build.build_data([copy_modified(f)], True, '2026-11-17'))
        self.assertEqual(html.count('</script>'), 2, '데이터 안의 </script>가 태그를 닫으면 안 된다(자료 칸 1개 + 코드 칸 1개)')


class Gate(unittest.TestCase):
    def run_cli(self, *args):
        return subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'build.py'), *args], capture_output=True, text=True, encoding='utf-8')

    def test_real_data_cannot_be_written_outside_private(self):
        out = os.path.join(tempfile.mkdtemp(), 'x.html')
        r = self.run_cli('--in', SAMPLE, '--out', out)
        self.assertNotEqual(r.returncode, 0); self.assertFalse(os.path.exists(out)); self.assertIn('private', r.stdout + r.stderr)

    def test_synthetic_flag_allows_other_folders(self):
        out = os.path.join(tempfile.mkdtemp(), 'x.html')
        r = self.run_cli('--in', SAMPLE, '--synthetic', '--out', out)
        self.assertEqual(r.returncode, 0, r.stderr); self.assertTrue(os.path.exists(out))


if __name__ == '__main__':
    unittest.main(verbosity=1)
