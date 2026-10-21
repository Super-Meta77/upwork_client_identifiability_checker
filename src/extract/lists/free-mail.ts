// D-06: email domains that belong to a mail provider, not to the client. An email on one of these
// is still evidence, but its domain is not recorded as a website.

export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.de', 'ymail.com',
  'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'msn.com', 'icloud.com', 'me.com',
  'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de', 'gmx.net',
  'web.de', 'mail.com', 'yandex.com', 'yandex.ru', 'mail.ru', 'zoho.com', 'qq.com', '163.com',
  '126.com', 'hey.com', 'fastmail.com', 'tutanota.com', 'tuta.io', 'inbox.com', 'rediffmail.com',
]);
