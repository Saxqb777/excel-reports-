"use client";
import { useEffect, useRef, useState } from "react";

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Tweens a number towards its target over `duration` ms. Returns the animated value. */
export function useTween(target: number | null, duration = 420): number | null {
  const [value, setValue] = useState<number | null>(target);
  const fromRef = useRef<number | null>(target);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (target === null || fromRef.current === null || typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const v = from + (target - from) * easeOut(t);
      setValue(v);
      if (t < 1) raf.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); fromRef.current = target; };
  }, [target, duration]);
  return value;
}

/** Tweens an array of numbers element-wise (arrays of different length snap). */
export function useTweenArray(target: number[], duration = 420): number[] {
  const [value, setValue] = useState<number[]>(target);
  const fromRef = useRef<number[]>(target);
  const raf = useRef<number | null>(null);
  const key = target.join(",");
  useEffect(() => {
    const from = fromRef.current;
    if (from.length !== target.length || typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = easeOut(t);
      setValue(target.map((v, i) => from[i] + (v - from[i]) * e));
      if (t < 1) raf.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); fromRef.current = target; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, duration]);
  return value;
}
