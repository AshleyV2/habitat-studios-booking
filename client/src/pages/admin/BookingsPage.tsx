import { BOOKING_STATUSES, BOOKING_STATUS_LABELS, type BookingSummaryDto, type RoomDto } from '@habitat/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, qs } from '../../api/client';
import { PageHeader } from '../../components/PageHeader';
import { Async, EmptyState } from '../../components/States';
import { useDebounced } from '../../hooks/useDebounced';
import { BookingsTable } from './DashboardPage';

export const useRooms = () => useQuery({ queryKey: ['admin', 'rooms'], queryFn: () => api.get<RoomDto[]>('/api/admin/rooms') });

export function BookingsPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search.trim());
  const filters = { status: params.get('status') ?? 'active', from: params.get('from') ?? '', to: params.get('to') ?? '', roomId: params.get('roomId') ?? '' };
  const rooms = useRooms();
  const query = useQuery({
    queryKey: ['admin', 'bookings', filters, q],
    queryFn: () => api.get<BookingSummaryDto[]>(`/api/admin/bookings${qs({ ...filters, status: filters.status === 'all' ? undefined : filters.status, q })}`),
    placeholderData: keepPreviousData,
  });
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };
  return (
    <>
      <PageHeader title="Bookings" actions={<Link to="/admin/bookings/new" className="btn btn--primary">New booking</Link>} />
      <div className="filters" role="search">
        <div className="field">
          <label htmlFor="f-status">Status</label>
          <select id="f-status" className="select" value={filters.status} onChange={(e) => set('status', e.target.value)}>
            <option value="active">Active (pending, confirmed, past)</option>
            {BOOKING_STATUSES.map((s) => <option key={s} value={s}>{BOOKING_STATUS_LABELS[s]}</option>)}
            <option value="all">Any status</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-room">Room</label>
          <select id="f-room" className="select" value={filters.roomId} onChange={(e) => set('roomId', e.target.value)}>
            <option value="">All rooms</option>
            {rooms.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-from">From</label>
          <input id="f-from" type="date" className="input" value={filters.from} onChange={(e) => set('from', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="f-to">To</label>
          <input id="f-to" type="date" className="input" value={filters.to} onChange={(e) => set('to', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="f-q">Search</label>
          <input id="f-q" type="search" className="input" placeholder="Name, email, band, reference" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="panel">
        <Async query={query}>{(list) => (list.length === 0 ? <EmptyState title="No bookings match these filters." /> : <BookingsTable bookings={list} />)}</Async>
      </div>
    </>
  );
}
