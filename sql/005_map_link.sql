-- Update 5: directions to the venue. Only touches ugh_settings.
alter table public.ugh_settings add column if not exists map_url text not null default '';
update public.ugh_settings set venue = 'Jaylayian''s Amusement Park and Resort', venue_area = '', map_url = 'https://maps.app.goo.gl/5kQHrM4UanD5tWbS9' where id = 1;
