# API for v1.0.0

_Things here will be updated frequently\*._

NOTE: _Access tokens expire 15 minutes after they are first issued!<br>Refresh tokens expire after 30 days! STORE THEM SECURELY!_

## Response conventions

- Successful requests typically return HTTP 200 with a JSON body containing `error: false`.
- Authentication failures return HTTP 401 with `{ "error": true }`.
- Permission failures and active account bans return HTTP 403 with `{ "error": true }`.
- Bad requests, invalid input, or missing resources typically return HTTP 400 with `{ "error": true }`.
- Not found routes return HTTP 404 with `{ "error": true }`.
- All JSON response field names use `camelCase`, including nested records.

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

*NOTE: Registering and logging in issue both an access token and a refresh token. The legacy `token` field remains for compatibility and contains the access token. Passing either an access token or refresh token to `/login` increments the account's authentication version before issuing the replacement pair, immediately invalidating every token from the previous generation.*

The protected server master can log in through this same endpoint with `{ "masterCode": "<MASTER CODE>" }`. On first startup, the server generates the code, writes it to `MASTER_CODE_FILE` (default `.master-code`), and prints it to the startup log. Keep this file and all startup logs secret. The master response sets `isMaster: true` and includes every moderation permission.

`POST` to `/logout`:<br>
HEADERS: `Authorization: Bearer <ACCESS OR REFRESH TOKEN>` or authentication cookies<br>
SUCCESS: HTTP 200 with `{ "error": false, "revoked": true }`<br>
This increments the account's authentication version, immediately invalidating all issued access and refresh tokens without storing token values. It also clears both authentication cookies and closes the user's active WebSockets.<br>

If the client sends `setCookie: true` in the request body, the server will also set `HttpOnly`, `Secure`, `SameSite=Lax` cookies named `accessToken` and `refreshToken` on the response. The flag is `false` by default.

## UPLOADS

> [!NOTE]
> Info for server hosts:<br>
> Uploads are disabled by default. Set `UPLOADS_ENABLED=true` to start the uploads server on `UPLOADS_PORT` (default `7002`). Set `UPLOADS_PUBLIC_URL` when that server is exposed through a public origin or reverse proxy. Files are stored in `UPLOADS_DIR` (default `uploads`) and are limited to 10 MB each.<br>
> To run a dedicated upload process, set `UPLOADS_ONLY=true`. That process starts only the listener on `UPLOADS_PORT`; the normal HTTP and WebSocket servers remain off. On the normal server, set `UPLOADS_UPSTREAM_URL` to the dedicated process's internal origin. The normal server then proxies `POST /upload` and `GET|HEAD /files/<ID>` to it, and the upstream setting enables uploads without starting a second local upload listener.
> Set the same long random `UPLOADS_INTERNAL_SECRET` on both processes. The normal server authenticates the caller and uses this secret to pass the uploader identity internally, so the uploads-only process does not need to share the normal server's user database. Set `UPLOADS_PUBLIC_URL` on both processes to the externally reachable normal-server origin; the uploads-only process uses it when constructing returned file URLs.

`POST` to `<UPLOADS PUBLIC URL>/upload`<br>
HEADERS: `Authorization: Bearer <ACCESS TOKEN>`<br>
BODY: either `multipart/form-data` with a `file` field, or raw file bytes with `Content-Type` and optional `X-File-Name` headers<br>
SUCCESS: HTTP 201 with `{ "error": false, "file": { "id": "<ID>", "url": "<PUBLIC FILE URL>", "size": 123, "type": "image/png" } }`<br>
ERROR: HTTP 413 with code `FILE_TOO_LARGE` when the file exceeds 10 MB<br>

Uploaded files are public at `GET <UPLOADS PUBLIC URL>/files/<ID>`. Uploading requires a valid, unbanned access token. Once uploads are enabled, new profile pictures, guild icons/banners, and post attachments must use URLs returned by this server. Upload the files first, then place their URLs in the normal JSON API request.

`GET /version` exposes upload capability discovery as `uploads: { enabled, url, maxFileSize }` so clients can hide upload controls when the feature is disabled.

## HOME

`GET` from `/home?page=<PAGE NUMBER>`<br>
HEADERS: `token` key expected if page number is above 1<br>
BODY: none<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "page": 1, "posts": [ { "id": 1, "userId": "<UUID>", "author": "<USER DATA>", "uuid": "<POST UUID>", "content": "Hello", "attachments": ["<UPLOAD URL>"], "ts": 1710000000000, "client": "unknown", "likes": 0, "usersLiked": "[]", "replyCount": 0 } ] }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`POST` to `/home`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: (JSON) `content`, optional `attachments` array (up to 10 URLs), and optional `clientId`. A post needs content, an attachment, or both.<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "content": "Hello", "attachments": ["<UPLOAD URL>"], "postId": 1, "postUuid": "<POST UUID>", "ts": 1710000000000, "author": "<USERNAME>", "clientId": "unknown" }`<br>
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

### Home comments and replies

`GET` or `POST` `/home/<POST ID OR UUID>/comments` lists comments or creates one with `{ "content": "..." }`.<br>
`DELETE` `/home/<POST ID OR UUID>/comments/<COMMENT ID OR UUID>` deletes the caller's comment.<br>
`GET` or `POST` `/home/<POST ID OR UUID>/replies` lists replies or creates one with `{ "content": "...", "parentReplyId": "<OPTIONAL REPLY ID OR UUID>" }`.<br>
`DELETE` `/home/<POST ID OR UUID>/replies/<REPLY ID OR UUID>` deletes the caller's reply and its descendants.<br>
All routes require `Authorization: Bearer <ACCESS TOKEN>`. Comment and reply results include the author's username and profile picture. Posts expose `commentCount` and `replyCount`.

## USERS

`GET` from `/user/<USERNAME>?page=<PAGE NUMBER>`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: none<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "user": { "username": "<USERNAME>", "pfp": null, "bio": null, "uuid": "<UUID>", "followerCount": 1, "followingCount": 2, "relationship": { "following": true, "followedBy": false, "mutual": false }, "followers": [] }, "userPosts": [ { "id": 1, "content": "Hello", "author": "<USERNAME>" } ] }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`PATCH` to `/user`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: (JSON) `username`, `pfp`, and/or `bio` keys optional. When uploads are enabled, `pfp` must be an uploads-server URL; use `null` to clear it.<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`POST` to `/user/<USERNAME OR UUID>/follow`<br>
HEADERS: `Authorization: Bearer <TOKEN>`<br>
SUCCESS: HTTP 200 with `{ "error": false, "following": true, "created": true }`. Repeating the request is safe and returns `created: false`.<br>

`DELETE` from `/user/<USERNAME OR UUID>/follow`<br>
HEADERS: `Authorization: Bearer <TOKEN>`<br>
SUCCESS: HTTP 200 with `{ "error": false, "following": false, "removed": true }`. Repeating the request is safe and returns `removed: false`.<br>

`GET` from `/user/<USERNAME OR UUID>/followers?page=<PAGE NUMBER>`<br>
HEADERS: `Authorization: Bearer <TOKEN>`<br>
SUCCESS: HTTP 200 with a paginated `users` array and `hasMore` flag.<br>

`GET` from `/user/<USERNAME OR UUID>/following?page=<PAGE NUMBER>`<br>
HEADERS: `Authorization: Bearer <TOKEN>`<br>
SUCCESS: HTTP 200 with a paginated `users` array and `hasMore` flag.<br>

`GET` from `/user/<USERNAME OR UUID>/relationship`<br>
HEADERS: `Authorization: Bearer <TOKEN>`<br>
SUCCESS: HTTP 200 with `following`, `followedBy`, and `mutual` booleans.<br>

## INBOX

`GET` from `/inbox?page=<PAGE NUMBER>`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: none<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "messages": [ { "id": "<UUID>", "senderId": "System", "content": "Welcome", "ts": 1710000000000, "read": 0 } ], "unread": true }`<br>
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
BODY: `{ "error": false, "guilds": [ { "uuid": "<GUILD UUID>", "name": "My Guild", "description": "Desc", "ownerId": "<UUID>", "memberIds": ["<UUID>"], "channels": [], "ts": 1710000000000 } ] }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`GET` from `/guilds/subscribed`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: none<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "guilds": [ { "uuid": "<GUILD UUID>", "name": "My Guild", "description": "Desc" } ] }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`POST` to `/guilds`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: (JSON) `name` and `description` keys expected; `icon` and `banner` URL keys are optional<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "guilds": { "id": "<GUILD UUID>", "name": "My Guild", "description": "Desc", "icon": null, "banner": null } }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`GET` from `/guild/<GUILD UUID>?page=<PAGE>`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: none<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "posts": [ { "guildId": "<GUILD UUID>", "id": 1, "content": "Hello", "channelId": "general", "ts": 1710000000000, "author": "<USERNAME>" } ] }`<br>
ERROR: HTTP 400 with `{ "error": true }`

`PATCH` to `/guild/<GUILD UUID>`<br>
HEADERS: (JSON) `Authorization: Bearer <TOKEN>`<br>
BODY: (JSON) `name`, `description`, `icon`, and/or `banner` keys optional. Use `null` to clear either image.<br>
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
BODY: (JSON) `content`, optional `attachments` array (up to 10 URLs), and optional `replyTo`. A post needs content, an attachment, or both.<br>
SUCCESS: HTTP 200<br>
BODY: `{ "error": false, "post": { "guildId": "<GUILD UUID>", "id": 1, "content": "Hello", "channelId": "<CHANNEL UUID>", "ts": 1710000000000, "author": "<USERNAME>" } }`<br>
ERROR: HTTP 400 with `{ "error": true }`

### Guild replies, reactions, and custom emojis

`GET` or `POST` `/guild/<GUILD UUID>/posts/<POST ID>/replies` lists direct replies or creates one with `{ "content": "...", "attachments": [] }`.<br>
Clients may also pass `replyTo` to the normal guild-post endpoint. The target must exist in the same guild and channel.<br>

`GET` `/guild/<GUILD UUID>/posts/<POST ID>/reactions` lists aggregated reactions.<br>
`POST` to the same path with `{ "emoji": "👍" }` adds the caller's reaction. `DELETE` removes it. Repeating either operation is safe.<br>

`GET` or `POST` `/guild/<GUILD UUID>/emojis` lists custom emojis or creates one with `{ "name": "party", "url": "<UPLOAD URL>" }`.<br>
`DELETE` `/guild/<GUILD UUID>/emojis/<EMOJI ID>` deletes a custom emoji and its reactions.<br>
Upload the emoji through the uploads server first. React using its returned custom emoji ID, its name, or `:name:`. Guild owners and roles with `manageEmojis` may manage custom emojis. Regular Unicode emoji require no registration.<br>

Fetched guild posts include `reactions`, with a count, resolved Unicode/custom emoji metadata, and `reactedByMe` for the caller.

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

Note: Every guild member can view history and post in channels that have no role rules. Once any role rule is configured for a channel, access is restricted to roles granted the relevant `view`, `send`, and `history` flags (guild owners always retain access).

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

## SERVER MODERATION

All server-moderation endpoints require an access token and the permission named for the operation. User path/body identifiers may be either a UUID or username. Every completed moderation action is written to `moderation_audit`.

Available permissions:

- `moderation.manage_permissions`
- `moderation.ban_users`
- `moderation.kick_users`
- `moderation.delete_home_posts`
- `moderation.send_inbox_messages`

`GET` from `/moderation/permissions`<br>
PERMISSION: `moderation.manage_permissions`<br>
SUCCESS: HTTP 200 with the caller's permissions and the list of available permissions.<br>

`GET` from `/moderation/users/<USER>/permissions`<br>
PERMISSION: `moderation.manage_permissions`<br>
SUCCESS: HTTP 200 with the target user's current permissions.<br>

`PATCH` to `/moderation/users/<USER>/permissions`<br>
PERMISSION: `moderation.manage_permissions`<br>
BODY: `{ "grant": ["moderation.kick_users"], "revoke": [] }`<br>
SUCCESS: HTTP 200 with the target user's updated permissions. Non-master permission managers cannot grant permissions they do not hold. Master permissions are implicit and cannot be changed.<br>

`GET` from `/moderation/bans`<br>
PERMISSION: `moderation.ban_users`<br>
SUCCESS: HTTP 200 with all active bans.<br>

`POST` to `/moderation/bans`<br>
PERMISSION: `moderation.ban_users`<br>
BODY: `{ "userId": "<UUID OR USERNAME>", "reason": "Reason", "durationSeconds": 3600 }`<br>
SUCCESS: HTTP 200 with the ban. Omit `durationSeconds` for a permanent ban. Banning revokes all existing tokens and immediately closes all of the user's WebSockets.<br>

`DELETE` from `/moderation/bans/<USER>`<br>
PERMISSION: `moderation.ban_users`<br>
SUCCESS: HTTP 200. The user must log in again after being unbanned.<br>

`POST` to `/moderation/kicks`<br>
PERMISSION: `moderation.kick_users`<br>
BODY: `{ "userId": "<UUID OR USERNAME>", "reason": "Reason" }`<br>
SUCCESS: HTTP 200. Kicking revokes all existing access and refresh tokens and immediately closes all of the user's WebSockets, but does not prevent a new login.<br>

`DELETE` from `/moderation/home/posts/<POST ID OR UUID>`<br>
PERMISSION: `moderation.delete_home_posts`<br>
BODY: `{ "reason": "Reason" }` (optional)<br>
SUCCESS: HTTP 200 and a `home:post:delete` WebSocket event.<br>

`POST` to `/moderation/inbox`<br>
PERMISSION: `moderation.send_inbox_messages`<br>
BODY: `{ "userId": "<UUID OR USERNAME>", "content": "Message" }`<br>
SUCCESS: HTTP 200. The recipient also receives an `inbox:message` WebSocket event when connected.<br>

Active bans return HTTP 403 with code `ACCOUNT_BANNED`. Revoked sessions return HTTP 401 with code `SESSION_REVOKED`. WebSocket authentication uses the same checks; banning a connected user sends `moderation:banned` before closing the socket.

## WEBSOCKET

All messages are JSON with a `type` field.

**Authenticate** (required before receiving events):<br>
SEND: `{ "type": "auth", "token": "<TOKEN>" }`<br>
RECEIVE: `{ "type": "authenticated", "username": "<USERNAME>", "permissions": [], "isMaster": false }` on success, or `{ "type": "error", "code": "...", "message": "..." }` on failure. Upon authentication, you are automatically subscribed to real-time events for all guilds you are a member of.

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
| `moderation:kicked`    | `reason`                     | Your sessions were revoked               |
| `moderation:banned`    | `reason`                     | Your account was banned                  |
| `auth:revoked`         | none                         | Your tokens were revoked through logout  |
| `home:comment:create`  | `postId, item`               | A Home comment was created                |
| `home:comment:delete`  | `postId, item`               | A Home comment was deleted                |
| `home:reply:create`    | `postId, item`               | A Home reply was created                  |
| `home:reply:delete`    | `postId, item`               | A Home reply tree was deleted             |
| `guild:post:reaction`  | `guildId, postId, reaction`  | A guild reaction changed                  |
| `guild:emoji:create`   | `guildId, emoji`             | A custom guild emoji was registered       |
| `guild:emoji:delete`   | `guildId, emoji`             | A custom guild emoji was deleted          |
