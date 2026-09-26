# Test corpus — tài liệu tham khảo cho RAG (tải 2026-09-08)

Chủ đề: **quy chế / quy định đào tạo đại học Việt Nam** (đào tạo tín chỉ, học vụ,
tuyển sinh, thạc sĩ, tiến sĩ, công tác sinh viên, học phí) — cùng miền với eval
dataset trong `evaluation/datasets/` (vốn là corpus *mô phỏng*; đây là văn bản thật).

- **27 PDF** (thư mục gốc) + **10 DOCX** (`docx/` — convert từ PDF tương ứng bằng
  LibreOffice để test đường ingest `.docx`; layout có nhiễu nhẹ, nội dung đủ).
- Tất cả có text-layer trừ `BGDDT_TT08-2021_quyche-daotao-DH_scan.pdf` (bản scan
  ký số — dùng để test nhánh OCR / `ANYDOC_OCR`).
- Thư mục này đã được thêm vào `.gitignore`.

## Ingest

```bash
cd /Volumes/Data/Documents/rag-reliability
for f in test-corpus/*.pdf test-corpus/docx/*.docx; do
  curl -sS -F "file=@$f" -F "title=$(basename "$f")" -F "source=test-corpus" \
    http://localhost:3000/documents ; echo
done
```

## Nguồn

### Văn bản pháp quy — Bộ GD&ĐT / Quốc hội (datafiles.chinhphu.vn)
| File | Nguồn |
|---|---|
| BGDDT_TT08-2021_quyche-daotao-DH_scan.pdf | https://datafiles.chinhphu.vn/cpp/files/vbpq/2021/04/08-bgd.signed.pdf |
| BGDDT_TT06_quy-dinh-giao-duc.pdf | https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/3/06-bgddt.pdf |
| BGDDT_quy-dinh-mo-nganh-dao-tao.pdf | https://datafiles.chinhphu.vn/cpp/files/vbpq/2024/12/07-vbhn-bgd.pdf |
| BGDDT_quyche-tuyen-sinh-di-hoc-nuoc-ngoai.pdf | https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/01/08-vbhn-bgddt-kem.pdf |
| BGDDT_quyche-04-VBHN.pdf | https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/9/04-vbhn-bgddt-kem.pdf |
| BGDDT_quyche-thi-tot-nghiep-THPT.pdf | https://datafiles.chinhphu.vn/cpp/files/vbpq/2024/4/01-vbhn-bgddt-kem.pdf |
| QuocHoi_Luat-Giao-duc_van-ban-hop-nhat.pdf | https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/3/72-vbhn-vpqh.pdf |

### Quy chế đào tạo — các trường đại học
| File | Nguồn |
|---|---|
| HUST_quyche-daotao-2014/2018/2023/2025 + credit-based EN | ctt.hust.edu.vn, soict.hust.edu.vn, hust.edu.vn |
| HCMUS_quyche-daotao-DH-2021.pdf | https://www.ctda.hcmus.edu.vn/wp-content/uploads/2023/03/Quy-che-dao-tao-2021.pdf |
| HCMUTE_quyche-daotao-DH.pdf | https://hcmute.edu.vn/Resources/Docs/SubDomain/fme/1727-qd-ban-hanh-quy-che-dao-tao-trinh-do-DH.pdf |
| HUIT_quyche-daotao-DH-tinchi-2025.pdf | huit.edu.vn |
| HAUI_quyche-daotao-DH-SICT.pdf / -DH-CD-tinchi.pdf | sict.haui.edu.vn, www.haui.edu.vn |
| TBD_quyche-daotao-DH-theo-TT08.pdf | https://tbd.edu.vn/wp-content/uploads/2024/05/Quy-che-dao-tao-dai-hoc_TBD_theo_TT08.pdf |
| ThangLong_quydinh-daotao-DH-tinchi.pdf | thanglong.edu.vn |
| TDTU_trich-quyche-daotao.pdf | admission.tdtu.edu.vn |
| DLU_quyche-daotao-thac-si.pdf | https://dlu.edu.vn/wp-content/uploads/2023/01/Quy-che-Thac-si-1.pdf |
| HLU_quydinh-tuyen-sinh-dao-tao-tien-si.pdf | sdh.hlu.edu.vn |
| UET-VNU_de-an-tuyen-sinh-2024.pdf | https://tuyensinh.uet.vnu.edu.vn/wp-content/images/Signed.QHI_De-an-TS-DHCQ-nam-2024.pdf |

### Công tác sinh viên
| File | Nguồn |
|---|---|
| HCMIU_quyche-cong-tac-sinh-vien-2022.pdf | iuoss.com (QĐ 967) |
| HCMULAW_quyche-cong-tac-sinh-vien.pdf / quyche-quyet-dinh-daotao.pdf | pctsv.hcmulaw.edu.vn |
| TUAF_quyche-hoc-sinh-sinh-vien-2017.pdf | tuaf.edu.vn (QĐ 686) |

> Vài tên miền `.edu.vn` bị chặn DNS trên máy này (ou.edu.vn, uit, humg, ctu, hcmue,
> vnua, apd…) nên không tải được — có thể bổ sung sau nếu cần thêm.
