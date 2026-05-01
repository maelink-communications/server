import { assert, assertEquals } from "@std/assert";

const BASE_URL = "http://localhost:7000";

async function request(method, path, body, headers = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // ignore non-json responses
  }

  return { res, data };
}

Deno.test("API flow", async (t) => {
  const unique = Date.now().toString();
  const username = `testuser_${unique}`;
  const password = "TestPassword123!";

  let token = null;
  let userId = null;

  await t.step("Register user", async () => {
    const { res, data } = await request("POST", "/register", {
      username,
      password,
    });

    assert(res.status === 200 || res.status === 201);
    assert(data);
  });

  await t.step("Login user", async () => {
    const { res, data } = await request("POST", "/login", {
      username,
      password,
    });
    console.log("Data from login request: ", data);

    assertEquals(res.status, 200);
    assert(data && data.user && data.user.token);

    token = data.user.token;
    userId = data.user.uuid;
  });

  await t.step("Create post", async () => {
    if (!token || !userId) return;

    const { res } = await request(
      "POST",
      "/post",
      {
        userId,
        content: `Test post at ${new Date().toISOString()}`,
      },
      {
        Authorization: `Bearer ${token}`,
      },
    );

    assertEquals(res.status, 200);
  });

  await t.step("Like post", async () => {
    const { res } = await request(
      "PATCH",
      "/post",
      { like: true, postId: 1, userId },
      { Authorization: `Bearer ${token}` },
    );
    assertEquals(res.status, 200);
  });

  await t.step("Fetch posts page 1", async () => {
    const { res } = await request("POST", "/home", undefined, { p: "1" });
    assertEquals(res.status, 200);
  });

  await t.step("Fetch posts page 2", async () => {
    const { res } = await request("POST", "/home", undefined, { p: "2" });
    assertEquals(res.status, 200);
  });

  await t.step("PATCH /post (expected failure)", async () => {
    if (!token) return;

    const { res } = await request(
      "PATCH",
      "/post",
      { id: 1, content: "Updated content" },
      { Authorization: `Bearer ${token}` },
    );

    assert(res.status >= 400);
  });

  await t.step("DELETE /post (expected failure)", async () => {
    if (!token) return;

    const { res } = await request(
      "DELETE",
      "/post",
      { id: 1 },
      { Authorization: `Bearer ${token}` },
    );

    assert(res.status >= 400);
  });

  await t.step("404 handling", async () => {
    const { res } = await request("GET", "/nonexistent");
    assertEquals(res.status, 404);
  });

  await t.step("Missing auth header", async () => {
    const { res } = await request("POST", "/post", {
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

    const { res } = await request("GET", "/user/" + userId, undefined, {
      Authorization: `Bearer ${token}`,
    });

    assertEquals(res.status, 200);
  });

  await t.step("Update user", async () => {
    if (!token || !userId) return;

    const patch = await request(
      "PATCH",
      "/user",
      { id: userId },
      { Authorization: `Bearer ${token}` },
    );

    assert(patch.res.status === 200 || patch.res.status === 204);
  });
});
