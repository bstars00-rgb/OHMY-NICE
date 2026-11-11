'use strict';
// Stand-in for the ELLIS MCP get_hotel_bookings tool, used by tests and by tools/make_ellis_sample.js.
// It enforces the same rules the real tool documents: window <= 30 days after fromDate, page size <= 1000, paging by offset/totalCount.
const Dates = require('../../js/core/dates.js');

/** rows: raw booking rows shaped like the real tool's output. opts.cap emulates a server that returns only the first N rows overall (truncation). */
function createFixtureSource(rows, opts) {
  opts = opts || {}; const calls = [];
  return {
    calls,
    async getBookings(a) {
      calls.push(JSON.parse(JSON.stringify(a)));
      if (!['BOOKING_DATE', 'CHECK_IN_DATE', 'CHECK_OUT_DATE'].includes(a.dateBasis)) throw new Error('INVALID_ARGUMENT: dateBasis');
      if (!Dates.isDate(a.fromDate) || !Dates.isDate(a.toDate)) throw new Error('INVALID_ARGUMENT: date');
      const span = Dates.diffDays(a.fromDate, a.toDate); if (span < 0 || span > 30) throw new Error('INVALID_ARGUMENT: toDate at most 30 days after fromDate');
      const limit = Math.min(a.limit || 100, 1000), offset = a.offset || 0;
      const key = a.dateBasis === 'CHECK_OUT_DATE' ? 'checkOutDate' : a.dateBasis === 'BOOKING_DATE' ? 'bookingDate' : 'checkInDate';   // dateBasis picks the date the window bounds
      const hit = rows.filter(r => (a.hotelCode == null || r.hotelCode === a.hotelCode) && Dates.cmp(Dates.dayOf(r[key]), a.fromDate) >= 0 && Dates.cmp(Dates.dayOf(r[key]), a.toDate) <= 0)
        .sort((x, y) => (x.bookingItemCode < y.bookingItemCode ? -1 : 1));
      const visible = opts.cap != null ? hit.slice(0, opts.cap) : hit;
      return { list: visible.slice(offset, offset + limit), totalCount: hit.length, limit, offset };
    },
  };
}

/** One synthetic booking row (same keys as the real tool, including the masked guest name that the snapshot must drop). */
function row(o) {
  return Object.assign({ bookingItemCode: 'SYN-0', bookingDate: '2026-09-01 10:00:00', checkInDate: '2026-10-05', checkOutDate: '2026-10-06', sellerName: 'Synthetic seller', hotelName: 'Synthetic Hotel', hotelCode: 90001, legacyHotelCode: null,
    hotelCountry: 'Synthetic', hotelCity: 'Synthetic', roomNights: 1, roomCount: 1, paxCount: 2, contractType: 'Exclusive Rate', cmsName: 'SYN-CMS', sellerBookingCode: 'SYN^1', paymentMethod: 'Cash',
    billing: 1000, revenue: 80, currency: 'KRW', baseCurrencyCode: 'KRW', fxRate: 1, bookingStatus: 'Reserved', cancelDate: null, guestName: '****' }, o || {});
}
module.exports = { createFixtureSource, row };
