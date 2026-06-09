-- AlterEnum: sipariş board aksiyonları için denetim (audit) işlem tipleri
ALTER TYPE "AuditAction" ADD VALUE 'CREATE_ORDER';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVE_ORDER';
ALTER TYPE "AuditAction" ADD VALUE 'CANCEL_ORDER';
ALTER TYPE "AuditAction" ADD VALUE 'DELETE_ORDER';
ALTER TYPE "AuditAction" ADD VALUE 'CLOSE_ORDER';
ALTER TYPE "AuditAction" ADD VALUE 'LABEL_ORDER';
ALTER TYPE "AuditAction" ADD VALUE 'CANCEL_LABEL';
