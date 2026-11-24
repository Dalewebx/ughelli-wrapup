-- Update 5: directions to the venue. Only touches ugh_settings.
alter table public.ugh_settings add column if not exists map_url text not null default '';
update public.ugh_settings set venue_area = 'Ughelli, Delta State' where id = 1 and venue_area = '';
