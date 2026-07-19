import { type RefObject, useEffect, useState } from "react";
import { registerMap } from "echarts/core";
import { feature } from "topojson-client";
import { ANALYTICS_WORLD_MAP_NAME } from "./constants";
import { sanitizeWorldMapGeoJson } from "./charts";
import type { WorldMapGeoJson } from "./types";

let analyticsWorldMapRegistered = false;

export function useContainerWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(ref.current);
    setWidth(ref.current.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

export function useWorldMapRegistration(enabled: boolean) {
  const [ready, setReady] = useState(analyticsWorldMapRegistered);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (analyticsWorldMapRegistered) {
      setReady(true);
      return;
    }
    let cancelled = false;
    fetch("/topojson/countries-110m.json")
      .then((response) => response.json())
      .then((topology) => {
        const geoJson = sanitizeWorldMapGeoJson(feature(
          topology as { type: "Topology"; objects: { countries: unknown } },
          topology.objects.countries as never,
        ) as WorldMapGeoJson);
        registerMap(ANALYTICS_WORLD_MAP_NAME, geoJson as never);
        analyticsWorldMapRegistered = true;
        if (!cancelled) {
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReady(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return ready;
}
