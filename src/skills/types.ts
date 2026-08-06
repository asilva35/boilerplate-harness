// SkillMeta is the lightweight index entry SkillRegistry builds by scanning
// .harness/skills/*.md: name + trigger (when this skill applies) + path -
// deliberately NOT the full file content, per the migration guide's
// "sin cargar el contenido completo todavía." digest.ts reads the body
// only for skills that already matched a task.

export interface SkillMeta {
  name: string;
  trigger: string;
  path: string;
}
