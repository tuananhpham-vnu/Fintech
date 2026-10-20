# Supabase root CA (public certificate, not a secret)

`supabase-prod-ca-2021.crt` is Supabase's public **Root 2021 CA**. Supabase's connection pooler
(`*.pooler.supabase.com`) presents a certificate chain `*.pooler.supabase.com` → `Supabase Intermediate 2021 CA`
→ `Supabase Root 2021 CA`, which Node's built-in CA list does not contain. The backend therefore connects with
`sslmode=verify-full&sslrootcert=/app/deploy/certs/supabase-prod-ca-2021.crt`: the server certificate must chain
to this root **and** match the host name.

- Source: `https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`
  (same file as Supabase Dashboard → Database settings → SSL configuration → Download certificate).
- SHA-256 fingerprint: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`
  (checked on 2026-10-20 against the root presented by `aws-0`/`aws-1-ap-southeast-1.pooler.supabase.com`).
- Valid until 2031-04-26. Replace it only with a newer certificate downloaded from your Supabase dashboard.
