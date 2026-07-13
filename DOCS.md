# API for v0.5.0 [beta]

_Things here will be updated frequently\*._

NOTE: _Access tokens expire 15 minutes after they are first issued!<br>Refresh tokens expire after 30 days! STORE THEM SECURELY!_

## Response conventions

- Successful requests typically return HTTP 200 with a JSON body containing `error: false`.
- Authentication failures return HTTP 401 with `{ "error": true }`.
- Bad requests, invalid input, or missing resources typically return HTTP 400 with `{ "error": true }`.
- Not found routes return HTTP 404 with `{ "error": true }`.

The examples below show the most common success payloads and the standard error payloads for each endpoint.

## AUTH / INIT

`GET` from `/version`<br>
HEADERS: none<br>
BODY: none<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "apiVersion": "<API VERSION>" }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`POST` to `/register`:<br>
HEADERS: none<br>
BODY: (JSON) `username, password` keys expected<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "user": { "uuid": "<UUID>", "username": "<USERNAME>", "pfp": null, "bio": null, "accessToken": "<ACCESS TOKEN>", "refreshToken": "<REFRESH TOKEN>" } }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`POST` to `/login`:<br>
HEADERS: none<br>
BODY: (JSON) `username, password` keys expected OR `token` key to authenticate with an existing token<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "user": { "uuid": "<UUID>", "username": "<USERNAME>", "pfp": null, "bio": null, "accessToken": "<ACCESS TOKEN>", "refreshToken": "<REFRESH TOKEN>" } }`<br>
ERROR: HTTP 401 with `{ "error": true }`

*NOTE: Registering and logging in now issue both an access token and a refresh token! The legacy `token` field remains for compatibility and contains the access token. Logging in with an existing token also rotates both tokens and returns the new values.*

If the client sends `setCookie: true` in the request body, the server will also set `HttpOnly`, `Secure`, `SameSite=Lax` cookies named `accessToken` and `refreshToken` on the response. The flag is `false` by default.

## HOME

`GET` from `/home?page=<PAGE NUMBER>`<br>
HEADERS: none<br>
BODY: none<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "page": 1, "posts": [ { "id": 1, "user_id": "<UUID>", "author": "<USERNAME>", "uuid": "<POST UUID>", "content": "Hello", "ts": 1710000000000, "client": "unknown", "likes": 0, "users_liked": "[]", "reply_count": 0 } ] }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`POST` to `/home`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: (JSON) `content` key expected<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "content": "Hello", "postId": 1, "postUuid": "<POST UUID>", "ts": 1710000000000, "author": "<USERNAME>", "clientId": "unknown" }`<br>
ERROR: HTTP 401 with `{ "error": true }` or HTTP 400 with `{ "error": true }`

`PATCH` to `/home`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: (JSON) `postId` required, `content` or `like` optional<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`DELETE` to `/home`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: (JSON) `postId` required<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false }`<br>
ERROR: HTTP 400 with `{ "error": true }`

## USERS

`GET` from `/user/<USER'S INTEGER ID>?page=<PAGE NUMBER>`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: none<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "user": { "username": "<USERNAME>", "pfp": null, "bio": null, "followers": [] }, "userPosts": [ { "id": 1, "content": "Hello", "author": "<USERNAME>" } ] }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`PATCH` to `/user`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: (JSON) `username`, `pfp`, and/or `bio` keys optional<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false }`<br>
ERROR: HTTP 400 with `{ "error": true }`

## INBOX

`GET` from `/inbox?page=<PAGE NUMBER>`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: none<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "messages": [ { "id": "<UUID>", "sender_id": "System", "content": "Welcome", "ts": 1710000000000, "read": 0 } ], "unread": true }`<br>
ERROR: HTTP 401 with `{ "error": true }` or HTTP 400 with `{ "error": true }`

`PATCH` to `/inbox`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: (JSON) `message_id` required (UUID string)<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "messages": true }`<br>
ERROR: HTTP 400 with `{ "error": true }`

## GUILDS

`GET` from `/guilds?page=<PAGE>`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: none<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "guilds": [ { "uuid": "<GUILD UUID>", "name": "My Guild", "description": "Desc", "ownerID": "<UUID>", "memberIDs": ["<UUID>"], "channels": [], "ts": 1710000000000 } ] }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`GET` from `/guilds/subscribed`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: none<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "guilds": [ { "uuid": "<GUILD UUID>", "name": "My Guild", "description": "Desc" } ] }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`POST` to `/guilds`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: (JSON) `name` and `description` keys expected<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "guilds": { "id": "<GUILD UUID>", "name": "My Guild", "description": "Desc" } }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`GET` from `/guild/<GUILD UUID>?page=<PAGE>`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: none<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "posts": [ { "guildId": "<GUILD UUID>", "id": 1, "content": "Hello", "channelId": "general", "ts": 1710000000000, "author": "<USERNAME>" } ] }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`PATCH` to `/guild/<GUILD UUID>`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: (JSON) `name` and/or `description` keys optional<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`DELETE` to `/guild/<GUILD UUID>`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: none<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`POST` to `/guild/<GUILD UUID>/<CHANNEL UUID>`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: (JSON) `content` key expected<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "post": { "guildId": "<GUILD UUID>", "id": 1, "content": "Hello", "channelId": "<CHANNEL UUID>", "ts": 1710000000000, "author": "<USERNAME>" } }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`POST` to `/guild/<GUILD UUID>/join`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: none<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "joined": true }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`DELETE` to `/guild/<GUILD UUID>/leave`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: none<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "left": true }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`GET` from `/guild/<GUILD UUID>/members`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: none<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "members": [ { "uuid": "<UUID>", "username": "<USERNAME>", "pfp": null } ] }`<br>
ERROR: HTTP 400 with `{ "error": true }`

## GUILD CHANNELS

`GET` from `/guild/channels/<GUILD UUID>`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: none<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "channels": [ { "id": "general", "name": "general", "posts": [ { "content": "Hello", "author": "<USERNAME>" } ] } ] }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`POST` to `/guild/channels`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: (JSON) `guildId` and `name` keys expected<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "channel": { "id": "<CHANNEL UUID>", "name": "announcements" } }`<br>
ERROR: HTTP 400 or HTTP 500 with `{ "error": true }`

`PATCH` to `/guild/channels/<GUILD UUID>`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: (JSON) `channelId` and `name` keys expected<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "channel": { "id": "<CHANNEL UUID>", "name": "announcements" } }`<br>
ERROR: HTTP 400 or HTTP 500 with `{ "error": true }`

`DELETE` to `/guild/channels`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: (JSON) `guildId` and `channelId` keys expected<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false }`<br>
ERROR: HTTP 400 or HTTP 500 with `{ "error": true }`

## GUILD ROLES & PERMISSIONS

`GET` from `/guild/<GUILD UUID>/roles`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: none<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "roles": [ { "id": "<ROLE UUID>", "name": "mods", "color": "#ff5757", "permissions": { "manageRoles": true, "banMembers": true } } ] }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`POST` to `/guild/<GUILD UUID>/roles`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: (JSON) `name` required, `color` optional, `permissions` optional<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "role": { "id": "<ROLE UUID>", "name": "mods", "color": "#ff5757", "permissions": { "manageRoles": true, "banMembers": true } } }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`POST` to `/guild/<GUILD UUID>/roles/<ROLE UUID>/members`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: (JSON) `userId` required<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "assigned": true }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`PATCH` to `/guild/<GUILD UUID>/channel-permissions`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: (JSON) `channelId`, `roleId`, `view`, `send`, and `history` keys expected<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "updated": true }`<br>
ERROR: HTTP 400 with `{ "error": true }`

Note: Channel access is enforced per role with three permission flags: `view`, `send`, and `history`.

## GUILD MODERATION

`POST` to `/guild/<GUILD UUID>/moderation/delete-post`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: (JSON) `postId` required<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "deleted": true }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`POST` to `/guild/<GUILD UUID>/moderation/kick`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: (JSON) `userId` required, `reason` optional<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "kicked": true }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`POST` to `/guild/<GUILD UUID>/moderation/ban`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: (JSON) `userId` required, `durationSeconds` optional, `reason` optional<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "banned": true }`<br>
ERROR: HTTP 400 with `{ "error": true }`

## WEBSOCKET

All messages are JSON with a `type` field.

**Authenticate** (required before receiving events):<br>
SEND: `{ "type": "auth", "token": "<TOKEN>" }`<br>
RECEIVE: `{ "type": "authenticated", "username": "<USERNAME>" }` on success, or `{ "type": "error", "message": "..." }` on failure. Upon authentication, you are automatically subscribed to real-time events for all guilds you are a member of.

**Events you will receive:**

| type                   | payload                      | description                              |
| ---------------------- | ---------------------------- | ---------------------------------------- |
| `home:post`            | post data                    | A new post was created on the home feed  |
| `home:post:edit`       | `postId, content`            | A home post was edited                   |
| `home:post:delete`     | `postId`                     | A home post was deleted                  |
| `home:post:like`       | `postId, users_liked`        | A home post was liked/unliked            |
| `guild:post`           | `guildId` + post data        | A new post was made in a guild you're in |
| `guild:update`         | `guildId, name, description` | A guild's info was updated               |
| `guild:channel:create` | `guildId, channel`           | A channel was created in a guild         |
| `guild:channel:delete` | `guildId, channelId`         | A channel was deleted in a guild         |
| `inbox:message`        | message data                 | You received a new inbox message         |
