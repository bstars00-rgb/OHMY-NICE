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


spec2 = importlib.util.spec_from_file_location('build_ceo', os.path.join(ROOT, 'tools', 'build_ceo.py'))
build_ceo = importlib.util.module_from_spec(spec2); spec2.loader.exec_module(build_ceo)


def run_ceo(*args):
    return subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'build_ceo.py'), *args], capture_output=True, text=True, encoding='utf-8')


class Assemble(unittest.TestCase):
    def build_public(self, xlsx=SAMPLE):
        out = os.path.join(tempfile.mkdtemp(), 'x.html')
        r = run_ceo('--public', '--sg-in', xlsx, '--out', out, '--today', '2026-11-17')
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        with open(out, encoding='utf-8') as f:
            return f.read()

    def test_public_html_has_ceo_base_and_sg_tab(self):
        html = self.build_public()
        for m in ('/*__SEED__*/', '/*__SGDATA__*/'):
            self.assertNotIn(m, html)
        for t in ('id="v-sg"', 'data-v="sg"', 'data-v="board"', 'data-v="credit"', 'data-v="hard"', 'renderSG()', 'const SEED = {"hotels"'):
            self.assertIn(t, html)

    def test_script_close_tag_in_data_is_escaped(self):
        base = self.build_public().count('</script>')
        def f(wb):
            wb['②프리바이목록']['C5'] = 'x</script><script>alert(1)</script>'
        html = self.build_public(copy_modified(f))
        self.assertEqual(html.count('</script>'), base, '자료 안의 </script>가 태그를 닫으면 안 된다')

    def test_csv_replaces_by_entity(self):
        d = tempfile.mkdtemp(); p = os.path.join(d, 'u.csv')
        with open(p, 'w', encoding='utf-8-sig', newline='') as f:
            f.write('corp,code,ym,amt,cur\nKR,A1,2026-10,"1,500",KRW\nKR,A2,2026-10,300,KRW\n')
        seed = {'hotels': [{'corp': 'KR', 'code': 'A1'}, {'corp': 'JP', 'code': 'J1'}], 'usage': [{'corp': 'KR', 'code': 'A1', 'ym': '2026-09', 'amt': 9}, {'corp': 'JP', 'code': 'J1', 'ym': '2026-09', 'amt': 7}]}
        n, corps = build_ceo.merge_csv(seed, 'usage', p)
        self.assertEqual((n, corps), (2, ['KR'])); self.assertEqual(sorted((u['corp'], u['code']) for u in seed['usage']), [('JP', 'J1'), ('KR', 'A1'), ('KR', 'A2')])
        self.assertEqual([u for u in seed['usage'] if u['code'] == 'A1'][0]['amt'], 1500, '쉼표 있는 숫자')


class Gate(unittest.TestCase):
    def test_real_data_cannot_be_written_outside_private(self):
        out = os.path.join(tempfile.mkdtemp(), 'x.html')
        r = run_ceo('--sg-in', SAMPLE, '--out', out)
        self.assertNotEqual(r.returncode, 0); self.assertFalse(os.path.exists(out)); self.assertIn('private', r.stdout + r.stderr)

    def test_public_flag_allows_other_folders(self):
        out = os.path.join(tempfile.mkdtemp(), 'x.html')
        r = run_ceo('--public', '--sg-in', SAMPLE, '--out', out)
        self.assertEqual(r.returncode, 0, r.stderr); self.assertTrue(os.path.exists(out))


if __name__ == '__main__':
    unittest.main(verbosity=1)
