type SqlBundleLayout = Readonly<Record<string, readonly string[]>>;

type SqlBundle<Layout extends SqlBundleLayout> = {
  readonly [Group in keyof Layout]: Readonly<
    Record<Layout[Group][number], string>
  >;
};

// Section markers organize related statements and fragments in one imported file.
// Strip the markers before execution while preserving each section's exact SQL.
export function readSqlBundle<const Layout extends SqlBundleLayout>(
  source: string,
  layout: Layout
): SqlBundle<Layout> {
  const headers = [...source.matchAll(/^\/\/ query: (?<name>\w+\.\w+)\n/gmu)];
  if (headers.length === 0 || headers[0]?.index !== 0) {
    throw new RangeError("SQL bundle must start with a query section");
  }
  const sections = new Map<string, string>();
  for (const [index, header] of headers.entries()) {
    const name = header.groups?.name;
    if (!name || sections.has(name)) {
      throw new RangeError(`Duplicate SQL bundle section ${name}`);
    }
    const end = headers[index + 1]?.index ?? source.length;
    const section = source.slice(header.index + header[0].length, end);
    if (!section.endsWith("\n")) {
      throw new RangeError(
        `SQL bundle section ${name} must end with a newline`
      );
    }
    sections.set(name, section.slice(0, -1));
  }
  const groups = Object.entries(layout).map(([group, names]) => [
    group,
    Object.fromEntries(
      names.map((name) => {
        const key = `${group}.${name}`;
        const section = sections.get(key);
        if (section === undefined) {
          throw new RangeError(`Missing SQL bundle section ${key}`);
        }
        sections.delete(key);
        return [name, section];
      })
    ),
  ]);
  if (sections.size > 0) {
    throw new RangeError(
      `Unexpected SQL bundle section ${sections.keys().next().value}`
    );
  }
  return Object.fromEntries(groups) as SqlBundle<Layout>;
}

// These fragments are generated SQL syntax, fixed identifiers, or other SQL templates.
// Request values remain positional parameters and must never enter this renderer.
export function renderSql(
  template: string,
  fragments: Readonly<Record<string, string | number>>
): string {
  return template.replaceAll(
    /\{\{(?<name>[a-zA-Z]\w*)\}\}/gu,
    (_placeholder: string, name: string) => {
      const fragment = fragments[name];
      if (fragment === undefined) {
        throw new RangeError(`Missing SQL template fragment ${name}`);
      }
      return String(fragment);
    }
  );
}
