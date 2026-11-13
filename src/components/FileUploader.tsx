import { useState } from "react";

export default function FileUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [openPreview, setPreview] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0];

    if (!selectedFile) return;

    setFile(selectedFile);
    setContent(null);
  }

  async function handlePreview() {
    if (!file) return;

    if (file.type.startsWith("image/") || file.type === "application/pdf") {
      setContent(URL.createObjectURL(file));
    } else if (
      file.type.startsWith("text/") ||
      file.type === "application/json"
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
    setContent(null);
  }

  return (
    <div className="space-y-4 w-[100%] flex align-center justify-center flex-col">
      <div className="w-[100%] flex align-center justify-center">
        <label
          className="
  flex cursor-pointer flex-col items-center justify-center
  rounded-sm border-2 border-dashed border-gray-300
  p-10 transition-colors
  hover:border-violet-500 hover:bg-violet-50
  w-[18%]
"
        >
          <span className="text-sm font-medium">Upload a file</span>

          <span className="mt-1 text-xs text-gray-500">
            PNG, JPG, PDF or TXT
          </span>

          <input type="file" className="hidden" onChange={handleFileChange} />
        </label>
      </div>

      {file && (
        <div className="space-y-2">
          <p>
            <span className="font-bold">Filename: </span> {file.name}
          </p>
          <p>
            <span className="font-bold">Size: </span>
            {(file.size / 1024).toFixed(2)} KB
          </p>
          <p>
            <span className="font-bold">Type: </span>
            {file.type || "Unknown"}
          </p>

          <div className="flex gap-5 mt-5">
            <button
              className="px-5 py-2 border cursor-pointer hover:bg-violet-700 hover:text-[#f5f5f5]"
              onClick={handlePreview}
            >
              Preview file
            </button>

            <button
              className="px-5 py-2 border cursor-pointer hover:bg-red-700 hover:text-[#f5f5f5]"
              onClick={handleRemove}
            >
              Remove file
            </button>

            <button className="px-5 py-2 border-gray-200 cursor-not-allowed bg-gray-100 text-gray-400">
              Start file (in development)
            </button>
          </div>
        </div>
      )}

      {openPreview && content && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="relative w-[90%] max-w-4xl max-h-[90vh] overflow-auto rounded-lg p-5">
            <button
              onClick={handleClosePreview}
              className="absolute right-4 top-4 px-3 py-1 border hover:bg-red-700 hover:text-white cursor-pointer"
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
