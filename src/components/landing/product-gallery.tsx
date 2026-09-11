"use client";

import { useState } from "react";
import Image, { type StaticImageData } from "next/image";
import { Tabs as TabsPrimitive } from "radix-ui";
import { Bot, FileText, Table2 } from "lucide-react";
import boardShot from "./captures/board.jpg";
import taskDetailsShot from "./captures/task-details.jpg";
import agentDockShot from "./captures/agent-dock.jpg";
import styles from "./editorial-landing.module.css";

type ScreenId = "board" | "task-details" | "agent-dock";

const SCREENS: {
  id: ScreenId;
  tab: string;
  icon: typeof Table2;
  label: string;
  text: string;
  asset: StaticImageData;
}[] = [
  {
    id: "board",
    tab: "Boards",
    icon: Table2,
    label: "Organize the work",
    text: "Group your items, customize fields and keep status, ownership and priorities together.",
    asset: boardShot,
  },
  {
    id: "task-details",
    tab: "Item details",
    icon: FileText,
    label: "Go into the details",
    text: "Open an item for its fields, updates, activity and files. AI assistance lives beside the work.",
    asset: taskDetailsShot,
  },
  {
    id: "agent-dock",
    tab: "Agent dock",
    icon: Bot,
    label: "Bring AI alongside",
    text: "Open the agent dock without leaving your board. Ask questions with your workspace as context.",
    asset: agentDockShot,
  },
];

/**
 * The product tour: a vertical view selector (Radix Tabs, keyboard-navigable)
 * beside one real product capture. Switching is pure client state — 0 server
 * round-trips (working agreement #5). All three captures are rendered so the
 * switch is instant; the inactive panels are hidden, not unmounted.
 */
export function ProductGallery() {
  const [screen, setScreen] = useState<ScreenId>("board");
  return (
    <TabsPrimitive.Root
      value={screen}
      onValueChange={(v) => setScreen(v as ScreenId)}
      orientation="vertical"
      className={styles.gallery}
    >
      <TabsPrimitive.List
        className={styles.screenTabs}
        aria-label="Product screens"
      >
        {SCREENS.map(({ id, tab, icon: Icon }) => (
          <TabsPrimitive.Trigger key={id} value={id}>
            <Icon size={16} aria-hidden="true" />
            {tab}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {SCREENS.map(({ id, label, text, asset }) => (
        <TabsPrimitive.Content
          key={id}
          value={id}
          forceMount
          hidden={screen !== id}
          className={styles.galleryPanel}
        >
          <div
            className={`${styles.galleryFrame} ${
              id === "board" ? "" : styles.galleryShifted
            }`}
          >
            <Image
              src={asset}
              alt={`Monolith interface: ${label}`}
              sizes="(max-width: 780px) 145vw, 940px"
              quality={85}
              priority={id === "board"}
            />
          </div>
          <div className={styles.galleryCaption}>
            <strong>{label}</strong>
            <p>{text}</p>
          </div>
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
