import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const secret = () => randomBytes(32).toString('hex');
const values = {
  PEERCALC_PORT: '8788',
  PEERCALC_CLIENT_SECRET: secret(),
  PEERCALC_COOKIE_SECRET: randomBytes(32).toString('base64url'),
  PEERCALC_ADMIN_PASSWORD: secret(),
  PEERCALC_OWNER_PASSWORD: secret(),
  CALC_CONVERTER_TOKEN: secret(),
};
try {
  writeFileSync('.env', Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''), { flag: 'wx', mode: 0o600 });
  console.log('Created private .env. Local account: owner@peercalc.local. Its password is PEERCALC_OWNER_PASSWORD in .env.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('.env already exists; existing credentials were preserved.');
}
