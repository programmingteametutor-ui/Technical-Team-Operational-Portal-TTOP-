// Serves the public Supabase settings from Vercel env vars (the anon key is public by design; RLS protects the data).
module.exports = (req, res) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send('window.TTOP_CONFIG=' + JSON.stringify({ url, anon }) + ';');
};
