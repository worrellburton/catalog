-- scraped-products bucket originally only allowed application/json (it
-- was provisioned for scraped product metadata). The Gemini-direct
-- polish pipeline uploads polished primary images under polished/<id>
-- there, so the allowlist needs image MIMEs too. Also bump the file
-- size limit from 5 MB → 10 MB to cover high-res polished outputs.

update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'application/json'],
    file_size_limit = 10485760
where id = 'scraped-products';
