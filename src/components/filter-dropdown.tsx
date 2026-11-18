"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export function FilterDropdown({
  value,
  options,
  label,
  onChange,
  icon,
  caption,
  className = "",
  searchable = false,
  searchPlaceholder,
}: {
  value: string;
  options: string[];
  label: string;
  onChange: (value: string) => void;
  icon?: ReactNode;
  caption?: string;
  className?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [optionSearch, setOptionSearch] = useState("");
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const filteredOptions = useMemo(() => {
    const search = optionSearch.trim().toLocaleLowerCase();
    return searchable && search ? options.filter((option) => option.toLocaleLowerCase().includes(search)) : options;
  }, [options, optionSearch, searchable]);
  const selectedIndex = Math.max(filteredOptions.indexOf(value), 0);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setOptionSearch("");
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  const focusOption = (index: number) => {
    requestAnimationFrame(() => optionRefs.current[index]?.focus());
  };

  const chooseOption = (option: string) => {
    onChange(option);
    setOpen(false);
    setOptionSearch("");
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      focusOption((index + direction + filteredOptions.length) % filteredOptions.length);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusOption(event.key === "Home" ? 0 : filteredOptions.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div
      className={`filter-dropdown ${className}`}
      ref={rootRef}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
          setOptionSearch("");
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`filter-dropdown-trigger ${open ? "open" : ""}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-controls={`${id}-options`}
        aria-expanded={open}
        onClick={() => {
          if (open) setOpen(false);
          else {
            setOptionSearch("");
            setOpen(true);
            requestAnimationFrame(() => searchable ? searchRef.current?.focus() : optionRefs.current[selectedIndex]?.focus());
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => searchable ? searchRef.current?.focus() : optionRefs.current[selectedIndex]?.focus());
          }
        }}
      >
        {icon}
        {caption && <span className="select-caption">{caption}</span>}
        <span className="filter-dropdown-value">{value}</span>
        <ChevronDown size={14} className="filter-dropdown-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className={`filter-dropdown-menu ${searchable ? "searchable" : ""}`}>
          {searchable && (
            <label className="filter-dropdown-search">
              <Search size={14} aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={optionSearch}
                onChange={(event) => setOptionSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setOpen(false);
                    setOptionSearch("");
                    triggerRef.current?.focus();
                  } else if (event.key === "ArrowDown" && filteredOptions.length) {
                    event.preventDefault();
                    focusOption(selectedIndex);
                  }
                }}
                placeholder={searchPlaceholder ?? `Search ${label.toLocaleLowerCase()}...`}
                aria-label={`Search ${label.toLocaleLowerCase()}`}
              />
            </label>
          )}
          <div id={`${id}-options`} className="filter-dropdown-options" role="listbox" aria-label={label}>
            {filteredOptions.map((option, index) => (
              <button
                key={option}
                ref={(element) => { optionRefs.current[index] = element; }}
                type="button"
                role="option"
                aria-selected={value === option}
                className={`filter-dropdown-option ${value === option ? "selected" : ""}`}
                onClick={() => chooseOption(option)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
              >
                <span>{option}</span>
                {value === option && <Check size={14} aria-hidden="true" />}
              </button>
            ))}
            {filteredOptions.length === 0 && <div className="filter-dropdown-empty" role="status">No matches found.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
