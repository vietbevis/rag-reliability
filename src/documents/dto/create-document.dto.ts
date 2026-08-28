import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body cho `POST /documents`. Có thể upload file (multipart, field `file`)
 * hoặc gửi text trực tiếp (`text` + `mimeType`). Các field khác là tuỳ chọn;
 * mặc định suy ra từ file.
 */
export class CreateDocumentDto {
  @ApiPropertyOptional({ description: 'Tiêu đề; mặc định = tên file' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ description: 'Nguồn tài liệu; mặc định = tên file' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  source?: string;

  @ApiPropertyOptional({
    description: 'MIME type khi gửi `text` (vd text/plain, text/markdown)',
  })
  @IsOptional()
  @IsString()
  mimeType?: string;

  @ApiPropertyOptional({
    description: 'Nội dung text thô (dùng khi không upload file)',
  })
  @IsOptional()
  @IsString()
  text?: string;
}
