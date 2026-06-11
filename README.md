<a href="https://ibb.co/h11T3vTV"><img src="https://i.ibb.co/3YYPgHPc/banner-protokol.png" alt="banner-protokol" border="0"></a>

## Registered endpoints

These are the only endpoints you should really worry about.

POST /register - Register a new user

POST /login - Authenticate a user (will give token that expires in 2 hours)

POST /home - Fetch home posts (optional "p" header for page number, 1 is default 1st page)

POST /post - Create a new post (requires Authorization header)

PATCH /post - Update post (requires Authorization header)

DELETE /post - Delete post (requires Authorization header)

GET /inbox - Fetch inbox messages (requires Authorization header, optional "p" header for page number, 1 is default 1st page)

PATCH /inbox - Set inbox messages as read (requires Authorization header and "message_id" (message integer ID) in body)

## - WHAT'S LEFT TO BE DONE! -

Home - post interactions:

- Liking posts
- Commenting on posts  
- Replying to posts(?)<br>
**Home is the very core of the service and as such is top priority!**

Bubbles - entire implementation:

- Bubble creation, modification and deletion
- Channel creation, modification and deletion
- Posting (and everything to do with home posts except with no likes or reposts and such)

User - fetch, edit, etc. /me endpoint needed! ✅ **Top priority!**

Settings - fetch, edit, etc. **Medium priority for clients**

Inbox - fetch, notif sending... that kind of thing. **Low-ish priority, does not need to be finished for beta release.**

Admin/mod - grant mod statuses, mod actions on everything, sending to inboxes, etc. ***THIS IS HIGH PRIORITY AFTER AT LEAST HOME IS DONE!***

ALL should probably be done before a public beta, one or two things probably don't need to be finished fully

## Running the server

1. Clone this repo and `cd` into the folder
2. Ensure you have Deno installed
3. install required packages with `deno task install`
4. Run `deno task start` to start the server
5. Run `deno test.js --allow-all --env-file [-- --node=<ADDRESS>]` and the program will automatically test endpoints and report errors for you
