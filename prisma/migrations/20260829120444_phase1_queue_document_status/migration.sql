-- PHASE 1 (queue): trạng thái QUEUED — document đã nhận, job xử lý đã đẩy vào
-- BullMQ queue, đang chờ worker nhận. Đặt giữa UPLOADED và PARSING về mặt ngữ
-- nghĩa (thứ tự khai báo enum không ảnh hưởng logic).
--
-- `ADD VALUE IF NOT EXISTS` để idempotent: một số môi trường dev đã có sẵn giá
-- trị này do lần `migrate dev` trước chạy dở.
ALTER TYPE "DocumentStatus" ADD VALUE IF NOT EXISTS 'QUEUED';
