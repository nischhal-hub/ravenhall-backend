import app from "./app";
import { logger } from "./config/logger";
import { prisma } from "./config/database";
import { startSlotGenerationCron } from "./jobs/slotGeneration.job";

const PORT = process.env.PORT || 4000;

async function bootstrap() {
  try {
    await prisma.$connect();
    logger.info("Database connected successfully");

    startSlotGenerationCron();

    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

bootstrap();

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received — shutting down gracefully");
  await prisma.$disconnect();
  process.exit(0);
});
