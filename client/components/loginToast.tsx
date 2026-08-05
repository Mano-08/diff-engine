import toast from "react-hot-toast";

export function showUnauthorizedToast() {
  toast.custom(
    (t) => (
      <div
        className={`
          ${t.visible ? "animate-custom-enter" : "animate-custom-leave"}
          w-full max-w-sm
          bg-white
          text-black
          rounded-xl
          shadow-2xl
          ring-1 ring-black/10
          pointer-events-auto
          overflow-hidden
        `}
      >
        <div className="p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold">Unauthorized</p>

              <p className="mt-1 text-xs text-neutral-500">
                Please log in to continue.
              </p>
            </div>

            <button
              onClick={() => {
                toast.dismiss(t.id);
                window.location.href = "/login";
              }}
              className="
                shrink-0
                rounded-lg
                bg-black
                px-4 py-2
                text-xs font-medium text-white
                transition
                hover:bg-neutral-800
                active:scale-95
              "
            >
              Login
            </button>
          </div>
        </div>
      </div>
    ),
    {
      duration: Infinity,
    },
  );
}
