# API for v0.3.3b

*Things here will be updated frequently\*.*

NOTE: *Tokens expire 2 hours after they are first issued!*

## AUTH
`POST` to `/register`:

HEADERS: none

BODY: (JSON) `username, password` keys expected

RETURN: Your user data and a token. Can only be used once per username.


`POST` to `/login`:

HEADERS: none

BODY: (JSON) `username, password` keys expected OR `token` key to authenticate with an existing token

RETURN: Your user data and a token (no token is provided if using token auth). Can be used infinitely.


## HOME
`GET` from `/home?page=<PAGE NUMBER>`

HEADERS: none

BODY: none

RETURN: A page of up to 25 posts in a JSON array. Page specifier is optional and defaults to 1.


`POST` to `/home`

HEADERS: (JSON) `Authorization` key expected with the value being `Bearer <TOKEN>`

BODY: (JSON) `content` key expected

RETURN: Your post's data as stored on the server.


`PATCH` to `/home`

HEADERS: (JSON) `Authorization` key expected with the value being `Bearer <TOKEN>`

BODY: (JSON) `postId` required (integer), `content` (if creator of post) and/or `like` (anyone) is optional (at least one is required)

RETURN: Updated post data as stored on the server.


`DELETE` to `/home`

HEADERS: (JSON) `Authorization` key expected with the value being `Bearer <TOKEN>`

BODY: (JSON) `postId` required (integer)

RETURN: `{ error: false }` if successful


## USERS
`GET` from `/user/<USER'S INTEGER ID>?page=<PAGE NUMBER>`

HEADERS: (JSON) `Authorization` key expected with the value being `Bearer <TOKEN>`

BODY: none

RETURN: User's data and home posts, if available. Page specifier is optional and defaults to 1.


`PATCH` to `/user`

HEADERS: (JSON) `Authorization` key expected with the value being `Bearer <TOKEN>`

BODY: (JSON) `username`, `pfp`, and/or `bio` keys optional (at least one required). `username` must be 3–24 characters, `pfp` must be 8+ characters, `bio` must be non-empty.

RETURN: `{ error: false }` if successful


## INBOX
`GET` from `/inbox?page=<PAGE NUMBER>`

HEADERS: (JSON) `Authorization` key expected with the value being `Bearer <TOKEN>`

BODY: none

RETURN: A page of up to 25 inbox messages and an `unread` boolean indicating whether you have unread messages. Page specifier is optional and defaults to 1.


`PATCH` to `/inbox`

HEADERS: (JSON) `Authorization` key expected with the value being `Bearer <TOKEN>`

BODY: (JSON) `message_id` required (UUID string)

RETURN: `{ error: false }` if the message was successfully marked as read


## GUILDS
`GET` from `/guilds?page=<PAGE>`

HEADERS: (JSON) `Authorization` key expected with the value being `Bearer <TOKEN>`

BODY: none

RETURN: A page of up to 25 guilds.


`GET` from `/guilds/subscribed`

HEADERS: (JSON) `Authorization` key expected with the value being `Bearer <TOKEN>`

BODY: none

RETURN: All guilds the authenticated user is a member of.


`POST` to `/guilds`

HEADERS: (JSON) `Authorization` key expected with the value being `Bearer <TOKEN>`

BODY: (JSON) `name` and `description` keys expected

RETURN: `{ error: false, guilds: <GUILD DATA> }` on success. A default `general` channel is created automatically.


`GET` from `/guild/<GUILD UUID>?page=<PAGE>`

HEADERS: (JSON) `Authorization` key expected with the value being `Bearer <TOKEN>`

BODY: none

RETURN: Posts in the guild, paginated. Must be a member.


`PATCH` to `/guild/<GUILD UUID>`

HEADERS: (JSON) `Authorization` key expected with the value being `Bearer <TOKEN>`

BODY: (JSON) `name` and/or `description` keys optional (at least one required)

RETURN: `{ error: false }` if successful. Owner only.


`DELETE` to `/guild/<GUILD UUID>`

HEADERS: (JSON) `Authorization` key expected with the value being `Bearer <TOKEN>`

BODY: none

RETURN: `{ error: false }` if successful. Owner only.


`POST` to `/guild/<GUILD UUID>/<CHANNEL UUID>`
HEADERS: (JSON) `Authorization` key expected with the value being `Bearer <TOKEN>`

BODY: (JSON) `content` key expected

RETURN: `{ error: false, post: <POST DATA> }` on success. Must be a member.


`POST` to `/guild/<GUILD UUID>/join`

HEADERS: (JSON) `Authorization` key expected with the value being `Bearer <TOKEN>`

BODY: none

RETURN: `{ error: false, joined: true }` if successful.


`DELETE` to `/guild/<GUILD UUID>/leave`

HEADERS: (JSON) `Authorization` key expected with the valuebeing `Bearer <TOKEN>`

BODY: none

RETURN: `{ error: false, left: true }` if successful. Guild owner cannot leave.


`GET` from `/guild/<GUILD UUID>/members`

HEADERS: (JSON) `Authorization` key expected with the value being `Bearer <TOKEN>`

BODY: none

RETURN: Array of member objects with `uuid`, `username`, and `pfp`. Must be a member.


## GUILD CHANNELS
`GET` from `/guild/channels/<GUILD UUID>`

HEADERS: (JSON) `Authorization` key expected with the value being `Bearer <TOKEN>`

BODY: none

RETURN: Array of channels, each with their most recent 25 posts. Must be a member.


`POST` to `/guild/channels`

HEADERS: (JSON) `Authorization` key expected with the value being `Bearer <TOKEN>`

BODY: (JSON) `guildId` and `name` keys expected

RETURN: `{ error: false, channel: <CHANNEL DATA> }` on success. Must be a member.


`PATCH` to `/guild/channels/<GUILD UUID>`

HEADERS: (JSON) `Authorization` key expected with the value being `Bearer <TOKEN>`

BODY: (JSON) `channelId` and `name` keys expected

RETURN: `{ error: false, channel: <CHANNEL DATA> }` on success. Must be a member.


`DELETE` to `/guild/channels`

HEADERS: (JSON) `Authorization` key expected with the value being `Bearer <TOKEN>`

BODY: (JSON) `guildId` and `channelId` keys expected

RETURN: `{ error: false }` if successful. Must be a member.


## WEBSOCKET
All messages are JSON with a `type` field.


**Authenticate** (required before receiving events):

SEND: `{ "type": "auth", "token": "<TOKEN>" }`

RECEIVE: `{ "type": "authenticated", "username": "<USERNAME>" }` on success, or `{ "type": "error", "message": "..." }` on failure. Upon authentication, you are automatically subscribed to real-time events for all guilds you are a member of.

**Events you will receive:**

| type | payload | description |
|---|---|---|
| `home:post` | post data | A new post was created on the home feed |
| `home:post:edit` | `postId, content` | A home post was edited |
| `home:post:delete` | `postId` | A home post was deleted |
| `guild:post` | `guildId` + post data | A new post was made in a guild you're in |
| `guild:update` | `guildId, name, description` | A guild's info was updated |
| `guild:channel:create` | `guildId, channel` | A channel was created in a guild |
| `guild:channel:delete` | `guildId, channelId` | A channel was deleted in a guild |
| `inbox:message` | message data | You received a new inbox message |
