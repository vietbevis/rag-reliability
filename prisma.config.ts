// Cấu hình trung tâm cho Prisma CLI (Prisma 7). Sinh bởi `prisma init`.
// `import "dotenv/config"` để nạp biến từ .env cho các lệnh Prisma.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
