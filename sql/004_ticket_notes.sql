-- Update 4: editable description line for each ticket type. Only touches ugh_settings.
alter table public.ugh_settings add column if not exists note_regular text not null default '1 person';
alter table public.ugh_settings add column if not exists note_vip text not null default 'Table for 4, a QR for each seat';
alter table public.ugh_settings add column if not exists note_vvip text not null default 'Table for 4, a QR for each seat';
