import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body cho `PUT /documents/:id` — thay nội dung một tài liệu đã tồn tại: upload
 * file mới (multipart, field `file`) hoặc gửi `text` mới. `title`/`source`/
 * `mimeType` tuỳ chọn; không gửi thì giữ nguyên giá trị cũ. Bắt buộc phải có
 * `file` hoặc `text` không rỗng (kiểm tại service).
 */
export class UpdateDocumentContentDto {
  @ApiPropertyOptional({ description: 'Tiêu đề mới; mặc định giữ nguyên' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ description: 'Nguồn mới; mặc định giữ nguyên' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  source?: string;

  @ApiPropertyOptional({
    description: 'MIME type khi gửi `text`; mặc định giữ nguyên của bản cũ',
  })
  @IsOptional()
  @IsString()
  mimeType?: string;

  @ApiPropertyOptional({
    description: 'Nội dung text thô mới (dùng khi không upload file)',
  })
  @IsOptional()
  @IsString()
  text?: string;
}
