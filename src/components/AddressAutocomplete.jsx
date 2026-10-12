import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Loader2, MapPin } from 'lucide-react';
import { EsriProvider } from 'leaflet-geosearch';

const AddressAutocomplete = ({ label, onSelect, initialValue = '', icon, disabled = false }) => {
    const [query, setQuery] = useState(initialValue);
    const [suggestions, setSuggestions] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const provider = useMemo(() => new EsriProvider(), []);
    const inputRef = useRef(null);
    const userTyped = useRef(false);
    const isMounted = useRef(true);

    useEffect(() => {
        isMounted.current = true;
        return () => { isMounted.current = false; };
    }, []);

    useEffect(() => {
        if (initialValue && !userTyped.current) {
            setQuery(initialValue);
        }
    }, [initialValue]);

    useEffect(() => {
        let active = true;

        const handleSearch = async () => {
            const trimmedQuery = query.trim();
            if (disabled || trimmedQuery.length < 3 || !userTyped.current) {
                setSuggestions([]);
                return;
            }

            setIsLoading(true);
            try {
                const results = await provider.search({ query: trimmedQuery });
                if (active && isMounted.current) {
                    setSuggestions(results || []);
                    setShowSuggestions(true);
                }
            } catch (error) {
                console.warn('🛡️ stability: Address search failed:', error);
                if (active && isMounted.current) setSuggestions([]);
            } finally {
                if (active && isMounted.current) setIsLoading(false);
            }
        };

        const debounce = setTimeout(() => {
            handleSearch();
        }, 500);

        return () => {
            active = false;
            clearTimeout(debounce);
        };
    }, [query, provider, disabled]);

    const handleSelect = (result) => {
        if (!result || disabled) return;
        userTyped.current = false;
        
        // BLINDAJE: Extracción segura de etiquetas
        const labelParts = (result.label || '').split(',');
        const mainName = labelParts[0] || 'Ubicación seleccionada';
        
        const place = {
            address: result.label || '',
            name: mainName,
            coordinates: { 
                lat: parseFloat(result.y || 0), 
                lng: parseFloat(result.x || 0) 
            }
        };

        setQuery(result.label || '');
        setShowSuggestions(false);
        if (onSelect) onSelect(place);
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (inputRef.current && !inputRef.current.contains(event.target)) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    return (
        <div className="relative" ref={inputRef}>
            <div className="relative">
                {icon ? (
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10">
                        {icon}
                    </div>
                ) : (
                    <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 z-10" />
                )}
                <Input
                    placeholder={label}
                    value={query}
                    disabled={disabled}
                    onChange={(e) => {
                        userTyped.current = true;
                        setQuery(e.target.value);
                    }}
                    className="h-14 pl-12 text-base w-full bg-white border-slate-100 shadow-sm focus-visible:ring-primary/20 disabled:opacity-60 disabled:cursor-not-allowed"
                />
                {isLoading && (
                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                        <Loader2 className="h-5 w-5 animate-spin text-primary/40" />
                    </div>
                )}
            </div>

            {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-[1000] w-full mt-2 bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
                    <ul className="max-h-60 overflow-y-auto custom-scrollbar">
                        {suggestions.map((result, index) => (
                            <li
                                key={`${index}-${result.label}`}
                                onClick={() => handleSelect(result)}
                                className="px-6 py-4 cursor-pointer hover:bg-slate-50 border-b border-slate-50 last:border-b-0 transition-colors"
                            >
                                <p className="font-bold text-slate-900 text-sm italic tracking-tight truncate">
                                    {(result.label || '').split(',')[0]}
                                </p>
                                <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest truncate mt-0.5">
                                    {(result.label || '').split(',').slice(1).join(',').trim()}
                                </p>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default AddressAutocomplete;
