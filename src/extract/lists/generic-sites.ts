// FR-17: websites that say nothing about who the client is. Matched on the registrable domain.
// Settings can add more.

export const GENERIC_SITES: ReadonlySet<string> = new Set([
  'upwork.com', 'google.com', 'youtube.com', 'youtu.be', 'facebook.com', 'fb.com', 'instagram.com',
  'linkedin.com', 'twitter.com', 'x.com', 'tiktok.com', 'pinterest.com', 'reddit.com', 'medium.com',
  'github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com', 'wikipedia.org', 'npmjs.com',
  'amazon.com', 'amazonaws.com', 'ebay.com', 'etsy.com', 'shopify.com', 'myshopify.com',
  'wordpress.com', 'wordpress.org', 'wix.com', 'squarespace.com', 'webflow.com', 'webflow.io',
  'figma.com', 'canva.com', 'dropbox.com', 'notion.so', 'notion.site', 'trello.com', 'asana.com',
  'slack.com', 'zoom.us', 'calendly.com', 'loom.com', 'vimeo.com', 'stripe.com', 'paypal.com',
  'apple.com', 'microsoft.com', 'office.com', 'live.com', 'godaddy.com', 'namecheap.com',
  'heroku.com', 'vercel.com', 'vercel.app', 'netlify.com', 'netlify.app', 'bubble.io', 'zapier.com',
  'hubspot.com', 'salesforce.com', 'mailchimp.com', 'openai.com', 'chatgpt.com', 'anthropic.com',
  'claude.ai', 'airbnb.com', 'uber.com', 'fiverr.com', 'freelancer.com', 'craigslist.org',
  'zillow.com', 'booking.com', 'yelp.com', 'bit.ly', 'goo.gl', 'tinyurl.com', 'example.com',
  'example.org', 'asp.net', 'vb.net', 'ado.net', 'dot.net', 'w3.org', 'schema.org', 'mozilla.org',
  'cloudflare.com', 'firebase.com', 'supabase.com', 'docker.com', 'atlassian.com', 'jira.com',
  'clickup.com', 'monday.com', 'airtable.com', 'typeform.com', 'gumroad.com', 'patreon.com',
  'twitch.tv', 'discord.com', 'discord.gg', 'whatsapp.com', 'telegram.org', 't.me', 'skype.com',
  'behance.net', 'dribbble.com', 'envato.com', 'themeforest.net', 'unsplash.com', 'pexels.com',
  'gstatic.com', 'googleusercontent.com', 'googleapis.com', 'apps.apple.com', 'play.google.com',
]);
