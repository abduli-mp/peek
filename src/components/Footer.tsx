import { IoHeart } from "react-icons/io5";

export default function Footer() {
  return (
    <div className="w-[100%] absolute bottom-0 right-0 px-6 py-5 flex justify-end">
      <p className="flex align-center gap-2">
        With <IoHeart />, by
        <a href="https://github.com/abduli-mp" target="blank" className="underline">
          abduli-mp
        </a>
      </p>
    </div>
  );
}
