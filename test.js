// Testing feature parity and functionality

const BASE_URL = "http://localhost:7000";

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testEndpoint(name, method, path, body = null, headers = {}) {
  try {
    const options = {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${BASE_URL}${path}`, options);
    const data = await response.json();

    if (response.ok) {
      log(`${name}`, "green");
      log(`  Status: ${response.status}`);
      log(`  Response:`, JSON.stringify(data, null, 2));
    } else {
      log(`${name}`, "red");
      log(`  Status: ${response.status}`);
      log(`  Response:`, JSON.stringify(data, null, 2));
    }

    return { success: response.ok, data, status: response.status };
  } catch (e) {
    log(`✗ ${name} - Error: ${e.message}`, "red");
    return { success: false, error: e.message };
  }
}

async function runTests() {
  log("\nBeginning tests...\n", "blue");

  // Test 1: Register a new user
  log("1. Testing User Registration", "yellow");
  let testUsername = `testuser_${Date.now()}`;
  let testPassword = "TestPassword123!";
  const registerResult = await testEndpoint(
    "POST /register",
    "POST",
    "/register",
    {
      username: testUsername,
      password: testPassword,
    },
  );
  log("");

  // Test 2: Login with credentials
  log("2. Testing User Login", "yellow");
  const loginResult = await testEndpoint("POST /login", "POST", "/login", {
    username: testUsername,
    password: testPassword,
  });
  log("");

  // Extract token from login response
  let authToken = null;
  if (loginResult.success && loginResult.data.user) {
    authToken = loginResult.data.user.token;
    log(`Token extracted: ${authToken.substring(0, 20)}...`, "green");
  } else {
    log("Could not extract token for subsequent tests...", "red");
  }
  log("");

  // Test 3: Create a post (requires token)
  if (authToken) {
    log("3. Testing Post Creation", "yellow");
    const userId = loginResult.data.user.uuid;
    await testEndpoint(
      "POST /post",
      "POST",
      "/post",
      {
        userId: userId,
        content: `Test post at ${new Date().toISOString()}`,
      },
      {
        Authorization: `Bearer ${authToken}`,
      },
    );
    log("");
  }

  // Test 4: Fetch posts
  log("4. Testing Fetch Posts", "yellow");
  await testEndpoint("POST /home (page 1)", "POST", "/home", null, { p: "1" });
  log("");

  // Test 5: Fetch posts with different page
  log("5. Testing Fetch Posts (Page 2)", "yellow");
  await testEndpoint("POST /home (page 2)", "POST", "/home", null, { p: "2" });
  log("");

  // Test 6: Test unimplemented PATCH endpoint
  log("6. Testing Unimplemented PATCH /post", "yellow");
  if (authToken) {
    await testEndpoint(
      "PATCH /post",
      "PATCH",
      "/post",
      { id: 1, content: "Updated content" },
      {
        Authorization: `Bearer ${authToken}`,
      },
    );
  } else {
    log("PATCH /post - Skipping (no token available)", "red");
  }
  log("");

  // Test 7: Test unimplemented DELETE endpoint
  log("7. Testing Unimplemented DELETE /post", "yellow");
  if (authToken) {
    await testEndpoint(
      "DELETE /post",
      "DELETE",
      "/post",
      { id: 1 },
      {
        Authorization: `Bearer ${authToken}`,
      },
    );
  } else {
    log("DELETE /post - Skipping (no token available)", "red");
  }
  log("");

  // Test 8: Test 404 endpoint
  log("8. Testing 404 Error Handling", "yellow");
  await testEndpoint("GET /nonexistent", "GET", "/nonexistent");
  log("");

  // Test 9: Test missing authorization
  log("9. Testing Missing Authorization Header", "yellow");
  await testEndpoint("POST /post (no auth)", "POST", "/post", {
    userId: "test-id",
    content: "This should fail",
  });
  log("");

  // Test 10: Test login with invalid credentials
  log("10. Testing Login with Invalid Credentials", "yellow");
  await testEndpoint("POST /login (invalid)", "POST", "/login", {
    username: "nonexistent_user",
    password: "WrongPassword123!",
  });
  log("");

  log("Tests completed.\n", "blue");
}

// Run tests
runTests().catch(console.error);
