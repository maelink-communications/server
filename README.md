# maelink server | codename protokol

### MAKE SURE YOU HAVE A .env FILE WITH THE JWT_SECRET SET!!!
**Otherwise, authentication will NOT work and tokens will NOT be generated.**
**NOTE: JWT_SECRET MUST HAVE A LENGTH OF 256 BITS**

## Registered endpoints:
POST /register - Register a new user

POST /login - Authenticate a user (will give token that expires in 2 hours)

POST /home - Fetch home posts (optional "p" header for page number, 1 is default 1st page)

POST /post - Create a new post (requires Authorization header)

PATCH /post - Update post (requires Authorization header)

DELETE /post - Delete post (requires Authorization header)
# - WHAT'S LEFT TO BE DONE! -
Home - post interactions:
- Liking posts
- Commenting on posts  
- Replying to posts(?)

Bubbles - entire implementation:
- Bubble creation, modification and deletion
- Channel creation, modification and deletion
- Posting (and everything to do with home posts except with no likes or reposts and such)
User - fetch, edit, etc. /me endpoint needed! ✅ (partially, don't just say "etc")

Settings - fetch, edit, etc. (don't say "etc")

Inbox - fetch, notif sending... (i know what you did)

Admin/mod - grant mod statuses, mod actions on everything, sending to inboxes, etc. (please stoppppp)

ALL should be done before a public beta.
## HOW TO RUN
1. run `git clone [repository (mae)link]` and `cd` into the folder
2. ensure you have deno and node.js installed
3. install required packages with `deno task install`
4. run `deno task start` to start the server
5. run `node test.js` and the program will automatically test endpoints and report errors for you
