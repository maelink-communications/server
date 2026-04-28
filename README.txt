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

- WHAT'S LEFT TO BE DONE! -
Home - post interactions
Bubbles - entire implementation:
    Bubble creation, modification and deletion
    Channel creation, modification and deletion
    Posting (and everything to do with home posts except with no likes or reposts and such)
User - fetch, edit, etc. /me endpoint needed!
Settings - fetch, edit, etc.
Inbox - fetch, notif sending...
Admin/mod - grant mod statuses, mod actions on everything, sending to inboxes, etc.

ALL should probably be done before a public beta.