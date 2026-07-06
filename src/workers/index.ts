// ponytail: Workers disabled — Redis removed. Re-add BullMQ + ioredis when background processing is needed.
console.log("Workers not configured. Set up a job queue to enable background processing.");
process.exit(0);
