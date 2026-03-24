import { createContext, useContext, createSignal, onMount, onCleanup, type ParentProps } from "solid-js"

interface DeviceContextValue {
    isMobile: () => boolean
    isTablet: () => boolean
    isDesktop: () => boolean
    isTouchDevice: () => boolean
}

const DeviceContext = createContext<DeviceContextValue>()

// Detect mobile UA
function isMobileUA(): boolean {
    if (typeof navigator === "undefined") return false
    return /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini|Mobile|mobile/i.test(
        navigator.userAgent
    )
}

export function DeviceProvider(props: ParentProps) {
    const [width, setWidth] = createSignal(
        typeof window !== "undefined" ? window.innerWidth : 1200
    )

    const mobileUA = isMobileUA()
    const touchDevice = typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0)

    onMount(() => {
        let timer: ReturnType<typeof setTimeout> | undefined
        function handleResize() {
            clearTimeout(timer)
            timer = setTimeout(() => setWidth(window.innerWidth), 100)
        }
        window.addEventListener("resize", handleResize)
        onCleanup(() => {
            clearTimeout(timer)
            window.removeEventListener("resize", handleResize)
        })
    })

    const value: DeviceContextValue = {
        isMobile: () => width() < 768 || (mobileUA && width() < 1024),
        isTablet: () => width() >= 768 && width() < 1024,
        isDesktop: () => width() >= 1024 && !mobileUA,
        isTouchDevice: () => touchDevice,
    }

    return (
        <DeviceContext.Provider value={value}>
            {props.children}
        </DeviceContext.Provider>
    )
}

export function useDevice() {
    const ctx = useContext(DeviceContext)
    if (!ctx) throw new Error("useDevice must be used within DeviceProvider")
    return ctx
}
