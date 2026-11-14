import { useState } from "react";
import { BiCollapseAlt, BiExpandAlt } from "react-icons/bi";
import semver from "semver";

type DependencyType =
  | "dependencies"
  | "devDependencies"
  | "peerDependencies"
  | "optionalDependencies";

type DependencyStatus =
  | "healthy"
  | "outdated"
  | "error"
  | "deprecated"
  | "vulnerable"
  | "conflict";

type Vulnerability = {
  id: string;
  summary: string;
  severity: string;
  fixed: string;
};

type Dependency = {
  name: string;
  declared: string;
  resolved: string;
  latest: string;
  type: DependencyType;
  status: DependencyStatus[];
  problems: string[];
  recommendations: string[];
  command: string;
  deprecated: boolean;
  vulnerabilities: Vulnerability[];
};

type PackageData = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

type LockPackage = {
  version?: string;
  resolved?: string;
  integrity?: string;
  dependencies?: Record<string, string>;
  optional?: boolean;
  dev?: boolean;
  peer?: boolean;
};

type LegacyLockDependency = {
  version?: string;
  dependencies?: Record<string, LegacyLockDependency>;
};

type PackageLockData = {
  name?: string;
  version?: string;
  lockfileVersion?: number;
  packages?: Record<string, LockPackage>;
  dependencies?: Record<string, LegacyLockDependency>;
};

type RegistryVersion = {
  deprecated?: string;
  peerDependencies?: Record<string, string>;
};

type RegistryData = {
  "dist-tags"?: {
    latest?: string;
  };
  versions?: Record<string, RegistryVersion>;
};

const categories: DependencyType[] = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

const registry = "https://registry.npmjs.org";
const osv = "https://api.osv.dev/v1/querybatch";

const MAX_CONCURRENT_REQUESTS = 5;

export default function FileUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lockFile, setLockFile] = useState<File | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [openPreview, setPreview] = useState(false);

  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [, setCurrentPackage] = useState<Record<string, string>>({});
  const [, setOptionalPeers] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  function handleSelectedFiles(selectedFiles: File[]) {
    for (const selectedFile of selectedFiles) {
      if (selectedFile.name === "package.json") {
        setFile(selectedFile);
      } else if (selectedFile.name === "package-lock.json") {
        setLockFile(selectedFile);
      }
    }

    setContent(null);
    setDependencies([]);
    setCurrentPackage({});
    setOptionalPeers([]);
    setAnalyzed(false);
    setError("");
    setExpanded(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    handleSelectedFiles(Array.from(e.target.files || []));
    e.target.value = "";
  }

  function handleDragOver(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsDragging(false);

    handleSelectedFiles(Array.from(e.dataTransfer.files));
  }

  async function handlePreview() {
    if (!file) return;

    if (file.type.startsWith("image/") || file.type === "application/pdf") {
      setContent(URL.createObjectURL(file));
    } else if (
      file.type.startsWith("text/") ||
      file.type === "application/json" ||
      file.name.endsWith(".json")
    ) {
      setContent(await file.text());
    } else {
      setContent("Preview not supported for this file type.");
    }

    setPreview(true);
  }

  function handleClosePreview() {
    if (content?.startsWith("blob:")) {
      URL.revokeObjectURL(content);
    }

    setContent(null);
    setPreview(false);
  }

  function handleRemove() {
    if (content?.startsWith("blob:")) {
      URL.revokeObjectURL(content);
    }

    setFile(null);
    setLockFile(null);
    setContent(null);
    setDependencies([]);
    setCurrentPackage({});
    setOptionalPeers([]);
    setAnalyzed(false);
    setError("");
    setExpanded(null);
  }

  // Validate npm package names.
  function validPackageName(name: string) {
    return /^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i.test(name);
  }

  // Run tasks with limited concurrency.
  async function runLimited<T>(
    tasks: (() => Promise<T>)[],
    limit: number,
  ): Promise<T[]> {
    const results: T[] = new Array(tasks.length);
    let nextIndex = 0;

    async function worker() {
      while (true) {
        const index = nextIndex++;

        if (index >= tasks.length) return;

        results[index] = await tasks[index]();
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(limit, tasks.length) }, () => worker()),
    );

    return results;
  }

  // Extract direct dependencies from npm lockfiles.
  function getResolvedDependencies(
    lock: PackageLockData,
  ): Record<string, string> {
    const resolved: Record<string, string> = {};

    // npm lockfile v2 and v3.
    if (lock.packages) {
      for (const [path, info] of Object.entries(lock.packages)) {
        if (!path.startsWith("node_modules/")) continue;
        if (!info.version) continue;

        const packageName = path.split("node_modules/").filter(Boolean).at(-1);

        if (!packageName) continue;

        // Ignore nested installations.
        const isNested = path
          .slice("node_modules/".length)
          .includes("/node_modules/");

        if (!isNested) {
          resolved[packageName] = info.version;
        }
      }

      return resolved;
    }

    // npm lockfile v1.
    if (lock.dependencies) {
      for (const [name, info] of Object.entries(lock.dependencies)) {
        if (info.version) {
          resolved[name] = info.version;
        }
      }
    }

    return resolved;
  }

  // Get package information from npm.
  async function getPackageInfo(
    name: string,
    declared: string,
    type: DependencyType,
    packageMap: Record<string, string>,
    optionalPeerNames: string[],
    resolvedMap: Record<string, string>,
    hasLockfile: boolean,
  ): Promise<Dependency> {
    const result: Dependency = {
      name,
      declared,
      resolved: "",
      latest: "",
      type,
      status: [],
      problems: [],
      recommendations: [],
      command: `npm install ${name}`,
      deprecated: false,
      vulnerabilities: [],
    };

    if (!validPackageName(name)) {
      result.status.push("error");
      result.problems.push("Invalid npm package name.");
      result.recommendations.push("Check the package name in package.json.");

      return result;
    }

    const range = semver.validRange(declared);

    if (!range) {
      result.status.push("error");
      result.problems.push("Invalid version specification.");
      result.recommendations.push(
        "Use a valid npm version range, such as ^1.0.0 or ~2.1.0.",
      );

      return result;
    }

    const minimum = semver.minVersion(range);

    if (!minimum) {
      result.status.push("error");
      result.problems.push("Could not resolve the declared version range.");

      return result;
    }

    const actualVersion = resolvedMap[name];

    if (hasLockfile && !actualVersion) {
      result.status.push("conflict");
      result.problems.push(
        "This dependency is declared in package.json but has no top-level entry in package-lock.json.",
      );
      result.recommendations.push(
        "Run npm install to synchronize package.json and package-lock.json.",
      );

      return result;
    }

    const resolvedVersion = actualVersion || minimum.version;

    if (!semver.valid(resolvedVersion)) {
      result.status.push("error");
      result.problems.push(
        `Invalid resolved version in package-lock.json: ${resolvedVersion}`,
      );

      return result;
    }

    result.resolved = resolvedVersion;

    if (!semver.satisfies(resolvedVersion, range)) {
      result.status.push("conflict");
      result.problems.push(
        `Resolved version ${resolvedVersion} does not satisfy the declared range ${declared}.`,
      );
      result.recommendations.push(
        "Run npm install to resolve the version mismatch.",
      );

      return result;
    }

    try {
      const response = await fetch(`${registry}/${encodeURIComponent(name)}`);

      if (!response.ok) {
        if (response.status === 404) {
          result.status.push("error");
          result.problems.push("Package was not found in the npm registry.");
          result.recommendations.push(
            "Check whether the package name is correct.",
          );

          return result;
        }

        throw new Error(`npm registry returned ${response.status}.`);
      }

      const metadata = (await response.json()) as RegistryData;
      const latest = metadata["dist-tags"]?.latest || "";

      result.latest = latest;

      const installedMetadata = metadata.versions?.[resolvedVersion];

      if (!installedMetadata) {
        result.status.push("error");
        result.problems.push(
          "The resolved version could not be found in npm registry metadata.",
        );

        return result;
      }

      // Check whether a newer version exists.
      if (semver.valid(latest) && semver.gt(latest, resolvedVersion)) {
        result.status.push("outdated");
        result.problems.push(`A newer version is available: ${latest}.`);
        result.recommendations.push(`Consider updating ${name} to ${latest}.`);
        result.command = `npm install ${name}@latest`;
      }

      // Check whether the installed version is deprecated.
      if (installedMetadata.deprecated) {
        result.deprecated = true;
        result.status.push("deprecated");
        result.problems.push(
          `This version is deprecated: ${installedMetadata.deprecated}`,
        );
        result.recommendations.push(
          "Consider replacing this package or updating to a supported version.",
        );
      }

      // Check peer dependency requirements.
      const peers = installedMetadata.peerDependencies || {};

      for (const [peerName, peerRange] of Object.entries(peers)) {
        if (optionalPeerNames.includes(peerName)) continue;

        const peerVersion = resolvedMap[peerName];

        if (!peerVersion) {
          if (!packageMap[peerName]) {
            result.status.push("conflict");
            result.problems.push(
              `Missing peer dependency: ${peerName} (${peerRange}).`,
            );
            result.recommendations.push(
              `Install the required peer dependency: npm install ${peerName}.`,
            );
          }

          continue;
        }

        if (
          !semver.valid(peerVersion) ||
          !semver.satisfies(peerVersion, peerRange)
        ) {
          result.status.push("conflict");
          result.problems.push(
            `Peer dependency conflict: ${peerName} requires ${peerRange}, but ${peerVersion} is installed.`,
          );
          result.recommendations.push(
            `Check compatibility with ${peerName}@${peerRange}.`,
          );
        }
      }
    } catch (err) {
      console.error(`Failed to retrieve metadata for ${name}:`, err);

      result.problems.push(
        "Could not retrieve package information from the npm registry.",
      );
      result.recommendations.push(
        "Check your internet connection and try again.",
      );
    }

    result.status = [...new Set(result.status)];

    return result;
  }

  // Security analysis using OSV.
  async function analyzeSecurity(items: Dependency[]): Promise<Dependency[]> {
    const validItems = items.filter(
      (item) => item.resolved && !item.status.includes("error"),
    );

    const batchSize = 100;

    for (let start = 0; start < validItems.length; start += batchSize) {
      const batch = validItems.slice(start, start + batchSize);

      const queries = batch.map((item) => ({
        package: {
          name: item.name,
          ecosystem: "npm",
        },
        version: item.resolved,
      }));

      try {
        const response = await fetch(osv, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ queries }),
        });

        if (!response.ok) {
          throw new Error("OSV request failed.");
        }

        const data = await response.json();

        data.results?.forEach((result: { vulns?: any[] }, index: number) => {
          const item = batch[index];

          if (!item || !result.vulns?.length) return;

          for (const vulnerability of result.vulns) {
            const cve = vulnerability.aliases?.find((alias: string) =>
              alias.startsWith("CVE-"),
            );

            const severity =
              vulnerability.database_specific?.severity ||
              vulnerability.severity?.[0]?.score ||
              "Unknown";

            const fixed =
              vulnerability.affected?.flatMap(
                (affected: any) =>
                  affected.ranges?.flatMap(
                    (range: any) =>
                      range.events
                        ?.filter((event: any) => event.fixed)
                        .map((event: any) => event.fixed) || [],
                  ) || [],
              )?.[0] || "No fix information available";

            item.vulnerabilities.push({
              id: cve || vulnerability.id,
              summary:
                vulnerability.summary ||
                vulnerability.details ||
                "No description available.",
              severity,
              fixed,
            });
          }

          if (item.vulnerabilities.length) {
            item.status.push("vulnerable");

            item.problems.push(
              `${item.vulnerabilities.length} known security vulnerability(s) detected.`,
            );

            item.recommendations.push(
              "Update to a patched version if one is available.",
            );

            const fixedVersions = item.vulnerabilities
              .map((v) => v.fixed)
              .filter(
                (version) =>
                  version !== "No fix information available" &&
                  semver.valid(version),
              );

            if (fixedVersions.length) {
              const highestFixed = fixedVersions.sort(semver.compare).at(-1);

              item.recommendations.push(
                `A patched version is available: ${highestFixed}. Verify compatibility before updating.`,
              );

              item.command = `npm install ${item.name}@${highestFixed}`;
            }
          }

          item.status = [...new Set(item.status)];
        });
      } catch {
        console.error("OSV security analysis failed.");

        batch.forEach((item) => {
          item.problems.push(
            "Security analysis could not be completed. This package's security status is unknown.",
          );
        });
      }
    }

    return items;
  }

  // Main dependency analysis.
  async function handleAnalyze() {
    if (!file) return;

    setLoading(true);
    setError("");
    setAnalyzed(false);
    setDependencies([]);
    setExpanded(null);

    try {
      const text = await file.text();
      const packageJson = JSON.parse(text) as PackageData;

      if (
        typeof packageJson !== "object" ||
        !packageJson ||
        Array.isArray(packageJson)
      ) {
        throw new Error("Invalid package.json structure.");
      }

      const packageMap: Record<string, string> = {};

      for (const category of categories) {
        const packages = packageJson[category];

        if (packages === undefined) continue;

        if (
          typeof packages !== "object" ||
          packages === null ||
          Array.isArray(packages)
        ) {
          throw new Error(`Invalid ${category} structure.`);
        }

        for (const [name, version] of Object.entries(packages)) {
          if (typeof version !== "string") {
            throw new Error(`Invalid version for dependency: ${name}`);
          }

          packageMap[name] = version;
        }
      }

      const optionalPeerNames = Object.entries(
        packageJson.peerDependenciesMeta || {},
      )
        .filter(([, meta]) => meta?.optional === true)
        .map(([name]) => name);

      let resolvedMap: Record<string, string> = {};

      if (lockFile) {
        const lockText = await lockFile.text();
        const lockJson = JSON.parse(lockText) as PackageLockData;

        if (
          typeof lockJson !== "object" ||
          !lockJson ||
          Array.isArray(lockJson)
        ) {
          throw new Error("Invalid package-lock.json structure.");
        }

        if (![1, 2, 3].includes(lockJson.lockfileVersion || 1)) {
          throw new Error(
            "Unsupported package-lock.json version. Supported versions are 1, 2 and 3.",
          );
        }

        resolvedMap = getResolvedDependencies(lockJson);
      }

      setCurrentPackage(packageMap);
      setOptionalPeers(optionalPeerNames);

      const tasks: (() => Promise<Dependency>)[] = [];

      for (const category of categories) {
        const packages = packageJson[category] || {};

        for (const [name, version] of Object.entries(packages)) {
          tasks.push(() =>
            getPackageInfo(
              name,
              version,
              category,
              packageMap,
              optionalPeerNames,
              resolvedMap,
              Boolean(lockFile),
            ),
          );
        }
      }

      const results = await runLimited(tasks, MAX_CONCURRENT_REQUESTS);

      const secured = await analyzeSecurity(results);

      setDependencies(secured);
      setAnalyzed(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to analyze package.json.",
      );
    } finally {
      setLoading(false);
    }
  }

  // Dashboard statistics.
  const stats = [
    {
      label: "Total scanned",
      value: dependencies.length,
    },
    {
      label: "Errors",
      value: dependencies.filter((d) => d.status.includes("error")).length,
    },
    {
      label: "Outdated",
      value: dependencies.filter((d) => d.status.includes("outdated")).length,
    },
    {
      label: "Vulnerabilities",
      value: dependencies.reduce(
        (total, d) => total + d.vulnerabilities.length,
        0,
      ),
    },
    {
      label: "Deprecated",
      value: dependencies.filter((d) => d.status.includes("deprecated")).length,
    },
    {
      label: "Conflicts",
      value: dependencies.filter((d) => d.status.includes("conflict")).length,
    },
  ];

  // Search and filtering.
  const filtered = dependencies.filter((dependency) => {
    const matchesSearch = dependency.name
      .toLowerCase()
      .includes(search.toLowerCase());

    const matchesFilter =
      filter === "all" ||
      (filter === "healthy"
        ? dependency.status.length === 0
        : dependency.status.includes(filter as DependencyStatus));

    return matchesSearch && matchesFilter;
  });

  function getStatus(dependency: Dependency) {
    if (dependency.status.includes("error")) return "Error";
    if (dependency.status.includes("vulnerable")) return "Vulnerable";
    if (dependency.status.includes("deprecated")) return "Deprecated";
    if (dependency.status.includes("conflict")) return "Conflict";
    if (dependency.status.includes("outdated")) return "Outdated";

    return "Healthy";
  }

  return (
    <div className="space-y-6 w-full flex flex-col mb-20">
      {/* FILE UPLOAD */}

      <div className="w-full flex items-center justify-center">
        <label
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
    flex cursor-pointer flex-col items-center justify-center
    border-2 border-dashed p-10 transition-colors
    w-[20%]
    ${
      isDragging
        ? "border-violet-500 bg-violet-50"
        : "border-gray-300 hover:border-violet-500 hover:bg-violet-50"
    }
  `}
        >
          <span className="text-sm font-medium">
            {isDragging ? "Drop your files here" : "Upload files"}
          </span>

          <span className="mt-1 text-xs text-gray-500">
            package.json or package-lock.json
          </span>

          <input
            type="file"
            accept=".json,application/json"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
        </label>
      </div>

      {file && (
        <div className="space-y-2">
          <p>
            <span className="font-bold">Filename: </span>
            {file.name}
          </p>

          <p>
            <span className="font-bold">Size: </span>
            {(file.size / 1024).toFixed(2)} KB
          </p>

          <p>
            <span className="font-bold">Type: </span>
            {file.type || "Unknown"}
          </p>

          <p>
            <span className="font-bold">Lockfile: </span>
            {lockFile ? lockFile.name : "Not provided"}
          </p>

          <div className="flex gap-5 mt-5">
            <button
              className="px-5 py-2 border cursor-pointer hover:bg-violet-700 hover:text-white"
              onClick={handlePreview}
            >
              Preview file
            </button>

            <button
              className="px-5 py-2 border cursor-pointer hover:bg-red-700 hover:text-white"
              onClick={handleRemove}
            >
              Remove file
            </button>

            <button
              disabled={loading}
              onClick={handleAnalyze}
              className="px-5 py-2 border cursor-pointer hover:bg-violet-700 hover:text-white disabled:opacity-50"
            >
              {loading ? "Analyzing..." : "Start analysis"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-red-600">{error}</p>}

      {/* ANALYSIS DASHBOARD */}

      {analyzed && (
        <div className="space-y-8 mt-8">
          <h2 className="text-xl font-semibold">Dependency Analysis</h2>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {stats.map((stat) => (
              <div key={stat.label} className="border p-5  space-y-2">
                <p className="text-sm text-gray-500">{stat.label}</p>

                <p className="text-2xl font-semibold">{stat.value}</p>
              </div>
            ))}
          </div>

          {/* SEARCH AND FILTER */}

          <div className="flex flex-col md:flex-row gap-3">
            <input
              type="text"
              placeholder="Search dependencies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border p-3 flex-1 outline-none focus:border-violet-500"
            />

            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="border py-3 px-4 outline-none focus:border-violet-500 appearance-auto cursor-pointer"
            >
              <option value="all" className="focus:bg-violet-700">
                All dependencies
              </option>
              <option value="error" className="focus:bg-violet-700">
                Errors
              </option>
              <option value="outdated">Outdated</option>
              <option value="vulnerable">Vulnerable</option>
              <option value="deprecated">Deprecated</option>
              <option value="conflict">Conflicts</option>
              <option value="healthy">Healthy</option>
            </select>
          </div>

          {/* DEPENDENCY TABLE */}

          <div className="overflow-x-auto border ">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-4">Package</th>
                  <th className="p-4">Declared</th>
                  <th className="p-4">Latest</th>
                  <th className="p-4">Category</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Details</th>
                </tr>
              </thead>

              <tbody>
                {filtered.map((dependency) => (
                  <tr
                    key={`${dependency.type}-${dependency.name}`}
                    className="border-t hover:bg-gray-50"
                  >
                    <td className="p-4 font-medium whitespace-nowrap">
                      {dependency.name}
                    </td>

                    <td className="p-4">{dependency.declared}</td>

                    <td className="p-4">{dependency.latest || "Unknown"}</td>

                    <td className="p-4 whitespace-nowrap">{dependency.type}</td>

                    <td className="p-4">
                      <span
                        className={
                          dependency.status.length
                            ? "text-red-600"
                            : "text-green-600"
                        }
                      >
                        {getStatus(dependency)}
                      </span>
                    </td>

                    <td className="p-4">
                      <button
                        onClick={() =>
                          setExpanded(
                            expanded === dependency.name
                              ? null
                              : dependency.name,
                          )
                        }
                        className="underline cursor-pointer hover:text-violet-600"
                      >
                        {expanded === dependency.name ? (
                          <BiCollapseAlt className="text-xl" />
                        ) : (
                          <BiExpandAlt className="text-xl" />
                        )}
                      </button>
                    </td>
                  </tr>
                ))}

                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-gray-500">
                      No dependencies found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* DEPENDENCY DETAILS */}

          {dependencies
            .filter((d) => d.name === expanded)
            .map((dependency) => (
              <div
                key={dependency.name}
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
              >
                <div
                  className="
      relative
      w-full md:w-[70%] lg:w-[50%] xl:w-[35%]
      max-h-[90vh]
      overflow-y-auto
      border border-gray-200
      bg-[#f5f5f5]
      p-6
      space-y-5
      shadow-xl
    "
                >
                  <div className="w-full flex items-center justify-between sticky top-0 py-2">
                    <h3 className="text-3xl font-semibold capitalize text-violet-700">
                      {dependency.name}
                    </h3>

                    <BiCollapseAlt
                      className="cursor-pointer hover:text-red-600 transition-colors"
                      onClick={() =>
                        setExpanded(
                          expanded === dependency.name ? null : dependency.name,
                        )
                      }
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <p>
                      <strong>Declared:</strong> {dependency.declared}
                    </p>

                    <p>
                      <strong>Resolved version:</strong>{" "}
                      {dependency.resolved || "Unknown"}
                    </p>

                    <p>
                      <strong>Latest:</strong> {dependency.latest || "Unknown"}
                    </p>

                    <p>
                      <strong>Deprecation:</strong>{" "}
                      {dependency.deprecated ? "Yes" : "No"}
                    </p>

                    <p>
                      <strong>Security:</strong>{" "}
                      {dependency.problems.some((p) =>
                        p.includes("Security analysis could not"),
                      )
                        ? "Unknown"
                        : dependency.vulnerabilities.length
                          ? "Vulnerabilities detected"
                          : "No known vulnerabilities found"}
                    </p>
                  </div>

                  {/* PROBLEMS */}

                  <div className="space-y-3">
                    <h4 className="font-semibold">Identified problems</h4>

                    {dependency.problems.length ? (
                      dependency.problems.map((problem, index) => (
                        <p key={index} className="text-red-600 text-sm">
                          {problem}
                        </p>
                      ))
                    ) : (
                      <p className="text-green-600 text-sm">
                        No problems identified.
                      </p>
                    )}
                  </div>

                  {/* VULNERABILITIES */}

                  {dependency.vulnerabilities.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="font-semibold">
                        Security vulnerabilities
                      </h4>

                      {dependency.vulnerabilities.map((vulnerability) => (
                        <div
                          key={vulnerability.id}
                          className="border p-4 space-y-2"
                        >
                          <p className="font-semibold text-red-600">
                            {vulnerability.id}
                          </p>

                          <p className="text-sm">{vulnerability.summary}</p>

                          <p className="text-sm">
                            <strong>Severity:</strong> {vulnerability.severity}
                          </p>

                          <p className="text-sm">
                            <strong>Fixed in:</strong> {vulnerability.fixed}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* RECOMMENDATIONS */}

                  <div className="space-y-3">
                    <h4 className="font-semibold">Recommendations</h4>

                    {dependency.recommendations.length ? (
                      dependency.recommendations.map(
                        (recommendation, index) => (
                          <p key={index} className="text-sm">
                            {recommendation}
                          </p>
                        ),
                      )
                    ) : (
                      <p className="text-sm text-green-600">
                        No changes recommended.
                      </p>
                    )}

                    {dependency.command && (
                      <div className="space-y-2">
                        <p className="font-medium text-sm">
                          Installation / update command
                        </p>

                        <pre className="overflow-x-auto bg-gray-300 p-4 text-sm">
                          {dependency.command}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* FILE PREVIEW */}

      {openPreview && content && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="relative w-[90%] max-w-4xl max-h-[90vh] overflow-auto p-5">
            <button
              onClick={handleClosePreview}
              className="absolute right-4 top-4 px-3 py-1 border border-white text-white hover:bg-red-700 hover:text-white cursor-pointer"
            >
              ✕
            </button>

            <div className="mt-10">
              {content.startsWith("blob:") &&
              file?.type.startsWith("image/") ? (
                <img
                  src={content}
                  alt="File preview"
                  className="max-h-[75vh] mx-auto object-contain"
                />
              ) : content.startsWith("blob:") ? (
                <iframe
                  src={content}
                  title="File preview"
                  className="h-[75vh] w-full"
                />
              ) : (
                <pre className="whitespace-pre-wrap overflow-auto rounded bg-gray-100 p-4">
                  {content}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
