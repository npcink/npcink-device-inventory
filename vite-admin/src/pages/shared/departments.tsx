import type { SelectProps } from "antd";
import { Tag } from "antd";

export const DEFAULT_DEPARTMENT = "未分配";

export const DESKTOP_RELEASE_URL = "https://github.com/npcink/npcink-device-inventory/releases/latest";

export const normalizeDepartmentList = (departments: unknown) => {
  const normalized = Array.isArray(departments)
    ? departments
        .map((department) => String(department || "").trim().slice(0, 80))
        .filter(Boolean)
    : [];
  if (!normalized.includes(DEFAULT_DEPARTMENT)) {
    normalized.push(DEFAULT_DEPARTMENT);
  }
  return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b, "zh-CN"));
};

export const departmentSelectOptions = (departments: string[]) =>
  normalizeDepartmentList(departments).map((department) => ({ label: department, value: department }));

export const departmentTagRender: SelectProps<string[]>["tagRender"] = ({ label, value, closable, onClose }) => {
  const protectedDepartment = String(value) === DEFAULT_DEPARTMENT;
  return (
    <Tag
      closable={!protectedDepartment && closable}
      onClose={onClose}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      title={protectedDepartment ? "系统兜底部门，不能删除" : undefined}
    >
      {label}
    </Tag>
  );
};

export const isAllowedDepartment = (departments: string[], value: unknown) => {
  const department = String(value || "").trim();
  return !department || normalizeDepartmentList(departments).includes(department);
};
