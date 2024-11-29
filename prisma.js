const { PrismaClient } = require('@prisma/client');

// Create a Prisma Client instance
const prisma = new PrismaClient();

module.exports = prisma;
