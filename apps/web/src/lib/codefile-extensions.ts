const extensionRegex = /\.[0-9a-z]+$/i;

export const codeFileExtensions: Record<string, string> = {
  ".c": "C",
  ".cpp": "C++",
  ".cs": "C#",
  ".css": "CSS",
  ".go": "Go",
  ".html": "HTML",
  ".java": "Java",
  ".js": "JavaScript",
  ".json": "JSON",
  ".jsx": "JavaScript React",
  ".kt": "Kotlin",
  ".less": "LESS",
  ".md": "Markdown",
  ".php": "PHP",
  ".py": "Python",
  ".rb": "Ruby",
  ".rs": "Rust",
  ".scss": "SCSS",
  ".sql": "SQL",
  ".swift": "Swift",
  ".ts": "TypeScript",
  ".tsx": "TypeScript React",
  ".xml": "XML",
  ".yaml": "YAML",
  ".yml": "YAML",
};

export function getLanguageFromFileName(fileName: string): string {
  const extension = fileName.toLowerCase().match(extensionRegex)?.[0];
  return extension ? (codeFileExtensions[extension] ?? "Code") : "Code";
}
