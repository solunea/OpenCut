"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/ui";

type DotLottiePlayer = InstanceType<
	(typeof import("@lottiefiles/dotlottie-web"))["DotLottie"]
>;

type LottiePreviewProps = {
	src: string;
	alt: string;
	fallbackSrc?: string;
	className?: string;
	canvasClassName?: string;
	fit?: "contain" | "cover";
	autoplay?: boolean;
	loop?: boolean;
};

export function LottiePreview({
	src,
	alt,
	fallbackSrc,
	className,
	canvasClassName,
	fit = "contain",
	autoplay = true,
	loop = true,
}: LottiePreviewProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const [isReady, setIsReady] = useState(false);
	const [hasError, setHasError] = useState(false);

	useEffect(() => {
		let isMounted = true;
		let player: DotLottiePlayer | null = null;
		let resizeObserver: ResizeObserver | null = null;

		const canvas = canvasRef.current;
		if (!canvas || !src) {
			setHasError(true);
			return;
		}

		setIsReady(false);
		setHasError(false);

		const resizeCanvas = () => {
			const currentCanvas = canvasRef.current;
			if (!currentCanvas) return;

			const rect = currentCanvas.getBoundingClientRect();
			const width = Math.max(1, Math.round(rect.width));
			const height = Math.max(1, Math.round(rect.height));

			if (currentCanvas.width !== width || currentCanvas.height !== height) {
				currentCanvas.width = width;
				currentCanvas.height = height;
				player?.resize();
			}
		};

		void import("@lottiefiles/dotlottie-web")
			.then(({ DotLottie }) => {
				if (!isMounted || !canvasRef.current) return;

				const nextPlayer = new DotLottie({
					canvas: canvasRef.current,
					src,
					autoplay,
					loop,
					renderConfig: {
						autoResize: false,
						devicePixelRatio: 1,
					},
				});
				player = nextPlayer;

				nextPlayer.addEventListener("load", () => {
					if (!isMounted) return;
					resizeCanvas();
					setIsReady(true);
				});

				nextPlayer.addEventListener("loadError", () => {
					if (!isMounted) return;
					setHasError(true);
				});

				resizeCanvas();
				resizeObserver = new ResizeObserver(() => resizeCanvas());
				resizeObserver.observe(canvasRef.current);
			})
			.catch(() => {
				if (!isMounted) return;
				setHasError(true);
			});

		return () => {
			isMounted = false;
			resizeObserver?.disconnect();
			player?.destroy();
		};
	}, [autoplay, loop, src]);

	return (
		<div className={cn("relative size-full overflow-hidden", className)}>
			{fallbackSrc && (!isReady || hasError) ? (
				<Image
					src={fallbackSrc}
					alt={alt}
					fill
					sizes="100vw"
					className={fit === "contain" ? "object-contain" : "object-cover"}
					loading="lazy"
					unoptimized
				/>
			) : null}
			<canvas
				ref={canvasRef}
				className={cn("relative block size-full", canvasClassName)}
				style={{ objectFit: fit, opacity: isReady && !hasError ? 1 : 0 }}
			/>
		</div>
	);
}
