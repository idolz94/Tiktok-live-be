// ponytail: minimal env so createApp() works in tests without a real .env
process.env.JWT_SECRET ||= "test_jwt_secret";
process.env.JWT_REFRESH_SECRET ||= "test_jwt_refresh_secret";
process.env.NODE_INTERNAL_API_KEY ||= "test_internal_key";
process.env.CLIENT_ORIGIN ||= "http://localhost:3000";
