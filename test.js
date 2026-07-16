import { assert, assertEquals } from "@std/assert";
import { Database } from "@db/sqlite";

let destroyPost;
let BASE_URL;
let unlike;
const UPLOADS_ENABLED = ["1", "true", "yes", "on"].includes(
  (Deno.env.get("UPLOADS_ENABLED") || "").toLowerCase(),
) || ["1", "true", "yes", "on"].includes(
  (Deno.env.get("UPLOADS_ONLY") || "").toLowerCase(),
) || Boolean((Deno.env.get("UPLOADS_UPSTREAM_URL") || "").trim());
const UPLOADS_BASE_URL = (Deno.env.get("UPLOADS_PUBLIC_URL") ||
  `http://localhost:${
    Deno.env.get("UPLOADS_UPSTREAM_URL")
      ? Deno.env.get("PORT") || 7000
      : Deno.env.get("UPLOADS_PORT") || 7002
  }`).replace(
    /\/$/,
    "",
  );

if (!Deno.args.includes("devserver")) {
  BASE_URL = "http://localhost:7000";
} else {
  BASE_URL = "https://dev.maelink.net";
}

if (!Deno.args.includes("seepost")) {
  destroyPost = true;
} else {
  destroyPost = false;
}

if (Deno.args.includes("unlike")) {
  unlike = true;
} else {
  unlike = false;
}

// Parse additional nodes from args: --node=http://localhost:7001
for (const arg of Deno.args) {
  if (arg.startsWith("--node=")) {
    NODES.push(arg.split("=")[1]);
  }
}

async function request(method, path, body, headers = {}) {
  const canHaveBody = method !== "GET" && method !== "HEAD";
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: canHaveBody && body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    if (!res.ok) {
      throw new Error(
        `${method} ${path} returned HTTP ${res.status} with a non-JSON error response`,
      );
    }
  }

  if (!res.ok) {
    assert(
      data && data.error === true,
      `${method} ${path} error response must set error=true`,
    );
    assert(
      typeof data.message === "string" && data.message.trim().length > 0,
      `${method} ${path} error response must include a non-empty message: ${
        JSON.stringify(data)
      }`,
    );
    if (data.stack !== undefined) {
      assert(
        typeof data.stack === "string" && data.stack.includes(data.message),
        `${method} ${path} error stack must be a string containing its message`,
      );
    }
    if (res.status >= 500) {
      throw new Error(
        `${method} ${path} failed with HTTP ${res.status}: ${data.message}${
          data.stack ? `\n${data.stack}` : ""
        }`,
      );
    }
  }

  return { res, data };
}

function getDB(dbPath = "main.db") {
  return new Database(dbPath);
}

function verifyPostInDB(db, postUuid, shouldExist = true) {
  const post = db.prepare(`SELECT * FROM posts WHERE uuid = ?`).value(postUuid);
  if (shouldExist) {
    assert(post !== undefined, `Post ${postUuid} should exist in DB`);
  } else {
    assert(post === undefined, `Post ${postUuid} should NOT exist in DB`);
  }
  return post;
}

function verifyUserInDB(db, userUuid, expectedData = {}) {
  const user = db.prepare(`SELECT * FROM users WHERE uuid = ?`).value(userUuid);
  assert(user !== undefined, `User ${userUuid} should exist in DB`);
  if (expectedData.username) {
    assertEquals(user[2], expectedData.username, `Username mismatch in DB`);
  }
  if (expectedData.bio !== undefined) {
    assertEquals(user[5], expectedData.bio, `Bio mismatch in DB`);
  }
  return user;
}

Deno.test("API flow", async (t) => {
  const unique = crypto.randomUUID().split("-")[0];
  const username = `testuser_${unique}`;
  const password = "TestPassword123!";

  let token = null;
  let refreshToken = null;
  let postId = null;
  let postUuid = null;
  let userId = null;
  let socialTargetId = null;
  let socialTargetUsername = null;
  let attachmentUrl = null;
  const db = getDB();

  await t.step("Register user", async () => {
    const { res, data } = await request("POST", "/register", {
      username,
      password,
    });

    assert(res.status === 200 || res.status === 201);
    assert(data);
    assert(
      data.user.accessToken,
      "Register response should include an access token",
    );
    assert(
      data.user.refreshToken,
      "Register response should include a refresh token",
    );
  });

  await t.step("Register user with cookie opt-in", async () => {
    const cookieUsername = `${username}_cookie`;
    const { res, data } = await request("POST", "/register", {
      username: cookieUsername,
      password,
      setCookie: true,
    });

    assertEquals(res.status, 200);
    const cookies = res.headers.getSetCookie?.() ?? [];
    assert(
      cookies.some((cookie) =>
        cookie.includes("accessToken=") && cookie.includes("HttpOnly") &&
        cookie.includes("Secure")
      ),
      "Register response should set an HttpOnly Secure cookie when requested",
    );
    socialTargetId = data.user.uuid;
    socialTargetUsername = cookieUsername;
  });

  await t.step("Login user", async () => {
    const { res, data } = await request("POST", "/login", {
      username,
      password,
    });
    assertEquals(res.status, 200);
    assert(data && data.user && data.user.accessToken);
    assert(
      data.user.accessToken,
      "Login response should include an access token",
    );
    assert(
      data.user.refreshToken,
      "Login response should include a refresh token",
    );

    token = data.user.accessToken;
    refreshToken = data.user.refreshToken;
    userId = data.user.uuid;
  });

  await t.step("Rotate login tokens with access token", async () => {
    const previousAccessToken = token;
    const previousRefreshToken = refreshToken;
    const { res, data } = await request("POST", "/login", {
      token: previousAccessToken,
    });

    assertEquals(res.status, 200);
    assert(data && data.user);

    token = data.user.accessToken;
    refreshToken = data.user.refreshToken;
    assert(token, "Rotated access token should be present");
    assert(refreshToken, "Rotated refresh token should be present");

    const oldAccess = await request("GET", "/inbox", undefined, {
      Authorization: `Bearer ${previousAccessToken}`,
    });
    assertEquals(oldAccess.res.status, 401);
    assertEquals(oldAccess.data.code, "SESSION_REVOKED");

    const oldRefresh = await request("POST", "/login", {
      refreshToken: previousRefreshToken,
    });
    assertEquals(oldRefresh.res.status, 401);
    assertEquals(oldRefresh.data.code, "SESSION_REVOKED");

    userId = data.user.uuid;
  });

  await t.step("Upload attachment when uploads are enabled", async () => {
    if (!UPLOADS_ENABLED) return;
    const upload = await fetch(`${UPLOADS_BASE_URL}/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain",
        "X-File-Name": "attachment.txt",
      },
      body: "upload integration test",
    });
    const data = await upload.json();
    assertEquals(upload.status, 201);
    assertEquals(data.file.size, 23);
    attachmentUrl = data.file.url;

    const downloaded = await fetch(attachmentUrl);
    assertEquals(downloaded.status, 200);
    assertEquals(await downloaded.text(), "upload integration test");

    const tooLarge = await fetch(`${UPLOADS_BASE_URL}/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(10 * 1024 * 1024 + 1),
    });
    assertEquals(tooLarge.status, 413);
    assertEquals((await tooLarge.json()).code, "FILE_TOO_LARGE");
  });

  await t.step("Create post", async () => {
    if (!token || !userId) return;

    const { res, data } = await request(
      "POST",
      "/home",
      {
        content: `Test post at ${new Date().toISOString()}`,
        attachments: attachmentUrl ? [attachmentUrl] : [],
      },
      {
        Authorization: `Bearer ${token}`,
      },
    );
    console.log("Post creation response data: ", data);

    assertEquals(res.status, 200);
    postId = data.postId;
    postUuid = data.postUuid;
    assertEquals(data.author.uuid, userId);
    assertEquals(data.author.username, username);
    assertEquals(Object.hasOwn(data.author, "bio"), true);
    assertEquals(Object.hasOwn(data.author, "pfp"), false);

    // Verify in local DB
    const dbPost = await verifyPostInDB(db, postUuid, true);
    if (dbPost) {
      console.log(`✓ Post ${postUuid} verified in local DB`);
    }
  });

  await t.step("Home comments and threaded replies", async () => {
    if (!token || !postId) return;
    const headers = { Authorization: `Bearer ${token}` };
    const comment = await request(
      "POST",
      `/home/${postId}/comments`,
      { content: "A comment" },
      headers,
    );
    assertEquals(comment.res.status, 200);
    assert(comment.data.comment.uuid);

    const rootReply = await request(
      "POST",
      `/home/${postId}/replies`,
      { content: "A reply" },
      headers,
    );
    assertEquals(rootReply.res.status, 200);
    const nestedReply = await request(
      "POST",
      `/home/${postId}/replies`,
      { content: "A nested reply", parentReplyId: rootReply.data.reply.uuid },
      headers,
    );
    assertEquals(nestedReply.res.status, 200);
    assertEquals(
      nestedReply.data.reply.parentReplyId,
      rootReply.data.reply.uuid,
    );

    const comments = await request(
      "GET",
      `/home/${postId}/comments`,
      undefined,
      headers,
    );
    const replies = await request(
      "GET",
      `/home/${postId}/replies`,
      undefined,
      headers,
    );
    assertEquals(comments.data.comments.length, 1);
    assertEquals(replies.data.replies.length, 2);

    const deleteComment = await request(
      "DELETE",
      `/home/${postId}/comments/${comment.data.comment.uuid}`,
      undefined,
      headers,
    );
    const deleteReply = await request(
      "DELETE",
      `/home/${postId}/replies/${rootReply.data.reply.uuid}`,
      undefined,
      headers,
    );
    assertEquals(deleteComment.res.status, 200);
    assertEquals(deleteReply.res.status, 200);
  });

  await t.step("Like post", async () => {
    const { res, data } = await request(
      "PATCH",
      "/home",
      { like: true, postId: postId },
      { Authorization: `Bearer ${token}` },
    );
    console.log("Like post response status: ", data);
    assertEquals(res.status, 200);

    // Verify like in local DB
    const dbPost = db
      .prepare(`SELECT likes, users_liked FROM posts WHERE uuid = ?`)
      .value(postUuid);
    assert(dbPost[0] >= 1, "Post should have at least 1 like");
    const liked = JSON.parse(dbPost[1]);
    assert(liked.includes(userId), "User should be in users_liked array");
    console.log(`✓ Like verified in local DB`);
  });

  if (unlike) {
    await t.step("Unlike post", async () => {
      const { res, data } = await request(
        "PATCH",
        "/home",
        { like: true, postId: postId },
        { Authorization: `Bearer ${token}` },
      );
      console.log("Unlike post response status: ", data);
      assertEquals(res.status, 200);
    });
  }

  await t.step("Fetch posts page 1", async () => {
    const { res, data } = await request(
      "GET",
      `/home?page=1`,
      undefined,
      undefined,
    );
    console.log(`Fetch posts response data: ${JSON.stringify(data)}`);
    assertEquals(res.status, 200);
    const fetchedPost = data.posts.find((post) => post.uuid === postUuid);
    assert(fetchedPost, "Created post should be returned");
    assertEquals(fetchedPost.userId, userId);
    assertEquals(fetchedPost.author.uuid, userId);
    assertEquals(fetchedPost.author.username, username);
    assertEquals(Object.hasOwn(fetchedPost.author, "bio"), true);
    assertEquals(Object.hasOwn(fetchedPost.author, "pfp"), false);
    assertEquals(Object.hasOwn(fetchedPost, "user_id"), false);
    assertEquals(Object.hasOwn(fetchedPost, "users_liked"), false);
    assertEquals(Object.hasOwn(fetchedPost, "reply_count"), false);
  });

  await t.step("Fetch posts page 2", async () => {
    const { res, data } = await request("GET", `/home?page=2`, undefined, {
      Authorization: `Bearer ${token.toString()}`,
    });
    console.log(`Fetch posts [page 2] response data: ${JSON.stringify(data)}`);
    assertEquals(res.status, 200);
  });

  await t.step("Fetch inbox messages", async () => {
    const { res, data } = await request("GET", "/inbox", undefined, {
      Authorization: `Bearer ${token.toString()}`,
    });
    console.log(`Fetch inbox messages response data: ${JSON.stringify(data)}`);
    assertEquals(res.status, 200);
    assert(data.messages.length > 0, "Registration inbox message should exist");
    assertEquals(typeof data.messages[0].senderId, "string");
    assertEquals(Object.hasOwn(data.messages[0], "sender_id"), false);
  });

  await t.step("Regular users cannot access server moderation", async () => {
    const { res, data } = await request(
      "GET",
      "/moderation/permissions",
      undefined,
      { Authorization: `Bearer ${token}` },
    );
    assertEquals(res.status, 403);
    assertEquals(data.code, "MISSING_PERMISSION");
  });

  await t.step("User following flow", async () => {
    if (!token || !socialTargetId || !socialTargetUsername) return;
    const headers = { Authorization: `Bearer ${token}` };

    const followed = await request(
      "POST",
      `/user/${socialTargetUsername}/follow`,
      {},
      headers,
    );
    assertEquals(followed.res.status, 200);
    assertEquals(followed.data.following, true);
    assertEquals(followed.data.created, true);

    const duplicate = await request(
      "POST",
      `/user/${socialTargetId}/follow`,
      {},
      headers,
    );
    assertEquals(duplicate.res.status, 200);
    assertEquals(duplicate.data.created, false);

    const relationship = await request(
      "GET",
      `/user/${socialTargetId}/relationship`,
      undefined,
      headers,
    );
    assertEquals(relationship.data.following, true);
    assertEquals(relationship.data.mutual, false);

    const followers = await request(
      "GET",
      `/user/${socialTargetId}/followers`,
      undefined,
      headers,
    );
    assert(
      followers.data.users.some((user) => user.uuid === userId),
      "Target's followers should include the authenticated user",
    );

    const following = await request(
      "GET",
      `/user/${username}/following`,
      undefined,
      headers,
    );
    assert(
      following.data.users.some((user) => user.uuid === socialTargetId),
      "Authenticated user's following list should include the target",
    );

    const unfollowed = await request(
      "DELETE",
      `/user/${socialTargetId}/follow`,
      {},
      headers,
    );
    assertEquals(unfollowed.res.status, 200);
    assertEquals(unfollowed.data.following, false);
    assertEquals(unfollowed.data.removed, true);
  });

  await t.step("PATCH /post", async () => {
    if (!token) return;

    const { res } = await request(
      "PATCH",
      "/home",
      { postId: postId, content: "Updated content" },
      { Authorization: `Bearer ${token}` },
    );

    assert(res.status >= 200);
  });

  await t.step("Guild endpoints coverage", async () => {
    if (!token) return;

    const guildHeaders = { Authorization: `Bearer ${token}` };

    const createGuild = await request(
      "POST",
      "/guilds",
      {
        name: `Guild ${unique}`,
        description: "Guild test",
        icon: attachmentUrl,
        banner: attachmentUrl,
      },
      guildHeaders,
    );
    assert(createGuild.res.status !== 404, "POST /guilds should be registered");

    const guildId = createGuild.data?.guilds?.id ?? createGuild.data?.id;
    if (guildId) {
      const listGuilds = await request(
        "GET",
        "/guilds",
        undefined,
        guildHeaders,
      );
      assert(listGuilds.res.status !== 404, "GET /guilds should be registered");
      const listedGuild = listGuilds.data.guilds.find((guild) =>
        guild.uuid === guildId
      );
      assert(listedGuild, "Created guild should be listed");
      assertEquals(listedGuild.ownerId, userId);
      assertEquals(
        Object.hasOwn(listedGuild, "ownerID"),
        false,
        "HTTP responses must not expose legacy ownerID keys",
      );

      const getGuildPosts = await request(
        "GET",
        `/guild/${guildId}`,
        undefined,
        guildHeaders,
      );
      assert(
        getGuildPosts.res.status !== 404,
        "GET /guild/:guildId should be registered",
      );

      const editGuild = await request(
        "PATCH",
        `/guild/${guildId}`,
        {
          name: `Updated ${unique}`,
          description: "Updated guild",
          icon: attachmentUrl,
          banner: attachmentUrl,
        },
        guildHeaders,
      );
      assert(
        editGuild.res.status !== 404,
        "PATCH /guild/:guildId should be registered",
      );

      const postToGuild = await request(
        "POST",
        `/guild/${guildId}/general`,
        {
          content: "Guild post",
          attachments: attachmentUrl ? [attachmentUrl] : [],
        },
        guildHeaders,
      );
      assert(
        postToGuild.res.status !== 404,
        "POST /guild/:guildId/:channelId should be registered",
      );

      const guildPostId = postToGuild.data?.post?.id;
      if (guildPostId) {
        assertEquals(postToGuild.data.post.guildId, guildId);
        assertEquals(postToGuild.data.post.userId, userId);
        assertEquals(postToGuild.data.post.author.uuid, userId);
        assertEquals(postToGuild.data.post.author.username, username);
        assertEquals(Object.hasOwn(postToGuild.data.post.author, "bio"), true);
        assertEquals(Object.hasOwn(postToGuild.data.post.author, "pfp"), false);
        assertEquals(Object.hasOwn(postToGuild.data.post, "guildID"), false);
        assertEquals(Object.hasOwn(postToGuild.data.post, "userID"), false);
        const reply = await request(
          "POST",
          `/guild/${guildId}/posts/${guildPostId}/replies`,
          { content: "Guild reply" },
          guildHeaders,
        );
        assertEquals(reply.res.status, 200);
        assertEquals(reply.data.reply.replyTo, guildPostId);

        const unicodeReaction = await request(
          "POST",
          `/guild/${guildId}/posts/${guildPostId}/reactions`,
          { emoji: "👍" },
          guildHeaders,
        );
        assertEquals(unicodeReaction.res.status, 200);
        assertEquals(unicodeReaction.data.reaction.count, 1);

        const emojiUrl = attachmentUrl || "https://example.invalid/custom.png";
        const customEmoji = await request(
          "POST",
          `/guild/${guildId}/emojis`,
          { name: `wave_${unique}`, url: emojiUrl },
          guildHeaders,
        );
        assertEquals(customEmoji.res.status, 200);
        const customReaction = await request(
          "POST",
          `/guild/${guildId}/posts/${guildPostId}/reactions`,
          { emoji: customEmoji.data.emoji.id },
          guildHeaders,
        );
        assertEquals(customReaction.res.status, 200);
        assertEquals(customReaction.data.reaction.emoji.type, "custom");

        const reactions = await request(
          "GET",
          `/guild/${guildId}/posts/${guildPostId}/reactions`,
          undefined,
          guildHeaders,
        );
        assertEquals(reactions.res.status, 200);
        assertEquals(reactions.data.reactions.length, 2);

        const removeUnicodeReaction = await request(
          "DELETE",
          `/guild/${guildId}/posts/${guildPostId}/reactions`,
          { emoji: "👍" },
          guildHeaders,
        );
        assertEquals(removeUnicodeReaction.res.status, 200);
        assertEquals(removeUnicodeReaction.data.reaction.count, 0);
      }

      const getChannels = await request(
        "GET",
        `/guild/channels/${guildId}`,
        undefined,
        guildHeaders,
      );
      assert(
        getChannels.res.status !== 404,
        "GET /guild/channels/:guildId should be registered",
      );

      const createChannel = await request(
        "POST",
        "/guild/channels",
        { guildId, name: `general-${unique}` },
        guildHeaders,
      );
      assert(
        createChannel.res.status !== 404,
        "POST /guild/channels should be registered",
      );

      const channelId = createChannel.data?.channel?.id ??
        createChannel.data?.id;
      if (channelId) {
        const patchChannel = await request(
          "PATCH",
          `/guild/channels/${guildId}`,
          { channelId, name: `updated-${unique}` },
          guildHeaders,
        );
        assert(
          patchChannel.res.status !== 404,
          "PATCH /guild/channels/:guildId should be registered",
        );

        const deleteChannel = await request(
          "DELETE",
          "/guild/channels",
          { guildId, channelId },
          guildHeaders,
        );
        assert(
          deleteChannel.res.status !== 404,
          "DELETE /guild/channels should be registered",
        );
      }

      const deleteGuild = await request(
        "DELETE",
        `/guild/${guildId}`,
        undefined,
        guildHeaders,
      );
      assert(
        deleteGuild.res.status !== 404,
        "DELETE /guild/:guildId should be registered",
      );
    }
  });

  await t.step("Guild permissions and moderation flow", async () => {
    if (!token || !userId) return;

    const modUsername = `mod_${unique}`;
    const modPassword = "ModPassword123!";

    const modRegister = await request("POST", "/register", {
      username: modUsername,
      password: modPassword,
    });
    assertEquals(
      modRegister.res.status,
      200,
      "Moderator registration should succeed",
    );
    const modUser = modRegister.data?.user;
    assert(modUser?.uuid, "Moderator user should be created");

    const modLogin = await request("POST", "/login", {
      username: modUsername,
      password: modPassword,
    });
    assertEquals(modLogin.res.status, 200, "Moderator login should succeed");
    const modToken = modLogin.data?.user?.accessToken;
    assert(modToken, "Moderator token should be present");

    const guildHeaders = { Authorization: `Bearer ${token}` };
    const createdGuild = await request(
      "POST",
      "/guilds",
      { name: `Perms ${unique}`, description: "Permission test guild" },
      guildHeaders,
    );
    assertEquals(
      createdGuild.res.status,
      200,
      "Permission test guild should be created",
    );
    const guildId = createdGuild.data?.guilds?.id ?? createdGuild.data?.id;
    assert(guildId, "Permission test guild should be returned");

    const roleCreate = await request(
      "POST",
      `/guild/${guildId}/roles`,
      {
        name: "mods",
        color: "#ff5757",
        permissions: {
          manageRoles: true,
          manageChannels: true,
          moderatePosts: true,
          kickMembers: true,
          banMembers: true,
        },
      },
      guildHeaders,
    );
    assertEquals(roleCreate.res.status, 200, "Role creation should succeed");
    const roleId = roleCreate.data?.role?.id;
    assert(roleId, "Role should be returned");

    const roleAssign = await request(
      "POST",
      `/guild/${guildId}/roles/${roleId}/members`,
      { userId: userId },
      guildHeaders,
    );
    assertEquals(roleAssign.res.status, 200, "Role assignment should succeed");

    const publicChannelCreate = await request(
      "POST",
      "/guild/channels",
      { guildId, name: `public-${unique}` },
      guildHeaders,
    );
    assertEquals(
      publicChannelCreate.res.status,
      200,
      "Unrestricted channel creation should succeed",
    );
    const publicChannelId = publicChannelCreate.data?.channel?.id;
    assert(publicChannelId, "Unrestricted channel should be returned");

    const channelPermissions = await request(
      "PATCH",
      `/guild/${guildId}/channel-permissions`,
      {
        channelId: "general",
        roleId,
        view: true,
        send: true,
        history: true,
      },
      guildHeaders,
    );
    assertEquals(
      channelPermissions.res.status,
      200,
      "Channel permission update should succeed",
    );

    const joinGuild = await request(
      "POST",
      `/guild/${guildId}/join`,
      {},
      { Authorization: `Bearer ${modToken}` },
    );
    assertEquals(
      joinGuild.res.status,
      200,
      "Moderator should be able to join the guild",
    );

    const memberChannels = await request(
      "GET",
      `/guild/channels/${guildId}`,
      undefined,
      { Authorization: `Bearer ${modToken}` },
    );
    assertEquals(memberChannels.res.status, 200);
    assert(
      memberChannels.data.channels.some((channel) =>
        channel.id === publicChannelId
      ),
      "A joining member should see channels without role requirements",
    );
    assert(
      !memberChannels.data.channels.some((channel) => channel.id === "general"),
      "A joining member should not see a role-gated channel",
    );

    const publicPost = await request(
      "POST",
      `/guild/${guildId}/${publicChannelId}`,
      { content: "Baseline guild access" },
      { Authorization: `Bearer ${modToken}` },
    );
    assertEquals(
      publicPost.res.status,
      200,
      "A joining member should be able to post in an unrestricted channel",
    );

    const restrictedPost = await request(
      "POST",
      `/guild/${guildId}/general`,
      { content: "Should remain role-gated" },
      { Authorization: `Bearer ${modToken}` },
    );
    assertEquals(
      restrictedPost.res.status,
      400,
      "Baseline access must not bypass a channel's role requirements",
    );

    const moderationDelete = await request(
      "POST",
      `/guild/${guildId}/moderation/delete-post`,
      { postId: "missing-post" },
      guildHeaders,
    );
    assertEquals(
      moderationDelete.res.status,
      400,
      "Deleting a missing post should fail gracefully",
    );

    const moderationKick = await request(
      "POST",
      `/guild/${guildId}/moderation/kick`,
      { userId: modUser.uuid, reason: "Test kick" },
      guildHeaders,
    );
    assertEquals(
      moderationKick.res.status,
      200,
      "Kick endpoint should succeed",
    );

    const rejoinGuild = await request(
      "POST",
      `/guild/${guildId}/join`,
      {},
      { Authorization: `Bearer ${modToken}` },
    );
    assertEquals(
      rejoinGuild.res.status,
      200,
      "Moderator should be able to rejoin after being kicked",
    );

    const moderationBan = await request(
      "POST",
      `/guild/${guildId}/moderation/ban`,
      { userId: modUser.uuid, durationSeconds: 3600, reason: "Test ban" },
      guildHeaders,
    );
    assertEquals(moderationBan.res.status, 200, "Ban endpoint should succeed");
  });

  if (destroyPost) {
    await t.step("DELETE /post", async () => {
      if (!token) return;

      const { res } = await request(
        "DELETE",
        "/home",
        { postId: postId },
        { Authorization: `Bearer ${token}` },
      );

      assert(res.status >= 200);

      // Verify deletion in local DB
      await verifyPostInDB(db, postUuid, false);
      console.log(`✓ Post ${postUuid} deletion verified in local DB`);
    });
  } else {
    console.log(
      "Skipping DELETE /post test. Run without seepost to enable it.",
    );
  }

  await t.step("404 handling", async () => {
    const { res } = await request("GET", "/nonexistent");
    assertEquals(res.status, 404);
  });

  await t.step("Endpoint paths are matched exactly", async () => {
    const unmatchedPaths = [
      ["POST", "/guilds/id/join"],
      ["GET", "/home/extra"],
      ["POST", "/guild/id/join/extra"],
    ];

    for (const [method, path] of unmatchedPaths) {
      const { res } = await request(method, path, {});
      assertEquals(res.status, 404, `${method} ${path} should not be routed`);
    }
  });

  await t.step("Missing auth header", async () => {
    const { res } = await request("POST", "/home", {
      userId: "test-id",
      content: "This should fail",
    });

    assert(res.status === 401 || res.status === 403);
  });

  await t.step("Invalid login", async () => {
    const { res } = await request("POST", "/login", {
      username: "nonexistent_user",
      password: "WrongPassword123!",
    });

    assert(res.status >= 400);
  });

  await t.step("Get user data", async () => {
    if (!token) return;

    const { res, data } = await request("GET", "/user/" + username, undefined, {
      Authorization: `Bearer ${token}`,
    });

    assertEquals(res.status, 200);
    console.log("User data:", data);
  });

  await t.step("Update user", async () => {
    if (!token) return;

    const newUsername = `u_${username}`;
    const newBio = "Updated bio";

    const patch = await request(
      "PATCH",
      "/user",
      { username: newUsername, bio: newBio, pfp: attachmentUrl },
      { Authorization: `Bearer ${token}` },
    );

    assert(patch.res.status === 200 || patch.res.status === 204);

    // Verify update in local DB
    await verifyUserInDB(db, userId, { username: newUsername, bio: newBio });
    console.log(`✓ User ${userId} update verified in local DB`);
  });

  await t.step("Logout revokes access and refresh tokens", async () => {
    if (!token || !refreshToken) return;

    const logout = await request(
      "POST",
      "/logout",
      {},
      { Authorization: `Bearer ${token}` },
    );
    assertEquals(logout.res.status, 200);
    assertEquals(logout.data.revoked, true);
    const cookies = logout.res.headers.getSetCookie?.() ?? [];
    assert(
      cookies.filter((cookie) => cookie.includes("Max-Age=0")).length >= 2,
      "Logout should clear access and refresh cookies",
    );

    const revokedAccess = await request("GET", "/inbox", undefined, {
      Authorization: `Bearer ${token}`,
    });
    assertEquals(revokedAccess.res.status, 401);
    assertEquals(revokedAccess.data.code, "SESSION_REVOKED");

    const revokedRefresh = await request("POST", "/login", {
      refreshToken,
    });
    assertEquals(revokedRefresh.res.status, 401);
    assertEquals(revokedRefresh.data.code, "SESSION_REVOKED");

    const freshLogin = await request("POST", "/login", {
      username: `u_${username}`,
      password,
    });
    assertEquals(freshLogin.res.status, 200);
  });
});
