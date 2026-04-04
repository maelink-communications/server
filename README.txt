maelink server | codename protokol

MAKE SURE YOU HAVE A .env FILE WITH THE JWT_SECRET SET!!!
Otherwise, authentication will NOT work and tokens will NOT be generated.

Registered endpoints:
POST /register - Register a new user
POST /login - Authenticate a user
POST /home - Fetch home posts (optional "p" header for pages)
POST /post - Create a new post (requires Authorization header)
PATCH /post - Update post (not implemented)
DELETE /post - Delete post (not implemented)