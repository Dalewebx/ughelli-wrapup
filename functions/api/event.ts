import { Env, getSettings, json, bad, publicSettings } from '../../server/lib';

export const onRequestGet = async ({ env }: { env: Env }) => {
  try {
    return json(publicSettings(await getSettings(env)));
  } catch (e: any) {
    return bad(e.message || 'Could not load the event', 500);
  }
};
