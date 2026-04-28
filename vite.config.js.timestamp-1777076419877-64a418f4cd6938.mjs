// vite.config.js
import { defineConfig } from "file:///C:/shareway%20v2%20supabase/node_modules/.pnpm/vite@5.4.21_@types+node@25.0.3/node_modules/vite/dist/node/index.js";
import react from "file:///C:/shareway%20v2%20supabase/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@5.4.21_@types+node@25.0.3_/node_modules/@vitejs/plugin-react/dist/index.js";
import path from "path";
import tailwindcss from "file:///C:/shareway%20v2%20supabase/node_modules/.pnpm/tailwindcss@3.4.19/node_modules/tailwindcss/lib/index.js";
import autoprefixer from "file:///C:/shareway%20v2%20supabase/node_modules/.pnpm/autoprefixer@10.4.23_postcss@8.5.6/node_modules/autoprefixer/lib/autoprefixer.js";
var vite_config_default = defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      plugins: [
        tailwindcss("./tailwind.config.js"),
        autoprefixer
      ]
    }
  },
  resolve: {
    alias: {
      // Usamos path.join y process.cwd() para evitar errores con espacios en Windows
      "@": path.join(process.cwd(), "src")
    },
    extensions: [".mjs", ".js", ".ts", ".jsx", ".tsx", ".json"]
  },
  optimizeDeps: {
    include: [
      "clsx",
      "tailwind-merge",
      "class-variance-authority",
      "@radix-ui/react-label",
      "@radix-ui/react-slot",
      "@radix-ui/react-popover",
      "@radix-ui/react-dialog",
      "@radix-ui/react-scroll-area",
      "@radix-ui/react-avatar",
      "@radix-ui/react-tabs",
      "@radix-ui/react-select",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-alert-dialog",
      "lucide-react",
      "date-fns",
      "@supabase/supabase-js",
      "leaflet",
      "react-leaflet",
      "leaflet-defaulticon-compatibility",
      "sonner"
    ]
  },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "ui-vendor": ["lucide-react", "class-variance-authority", "tailwind-merge"],
          "radix": [
            "@radix-ui/react-label",
            "@radix-ui/react-slot",
            "@radix-ui/react-popover",
            "@radix-ui/react-dialog",
            "@radix-ui/react-scroll-area",
            "@radix-ui/react-avatar",
            "@radix-ui/react-tabs",
            "@radix-ui/react-select",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-alert-dialog"
          ],
          "maps": ["leaflet", "react-leaflet", "leaflet-defaulticon-compatibility"],
          "supabase": ["@supabase/supabase-js"],
          "date": ["date-fns"],
          "notify": ["sonner"]
        }
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxzaGFyZXdheSB2MiBzdXBhYmFzZVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiQzpcXFxcc2hhcmV3YXkgdjIgc3VwYWJhc2VcXFxcdml0ZS5jb25maWcuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0M6L3NoYXJld2F5JTIwdjIlMjBzdXBhYmFzZS92aXRlLmNvbmZpZy5qc1wiO2ltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGUnO1xyXG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xyXG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcclxuaW1wb3J0IHRhaWx3aW5kY3NzIGZyb20gJ3RhaWx3aW5kY3NzJztcclxuaW1wb3J0IGF1dG9wcmVmaXhlciBmcm9tICdhdXRvcHJlZml4ZXInO1xyXG5cclxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcclxuICAgIHBsdWdpbnM6IFtyZWFjdCgpXSxcclxuICAgIGNzczoge1xyXG4gICAgICAgIHBvc3Rjc3M6IHtcclxuICAgICAgICAgICAgcGx1Z2luczogW1xyXG4gICAgICAgICAgICAgICAgdGFpbHdpbmRjc3MoJy4vdGFpbHdpbmQuY29uZmlnLmpzJyksXHJcbiAgICAgICAgICAgICAgICBhdXRvcHJlZml4ZXIsXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgfSxcclxuICAgIH0sXHJcbiAgICByZXNvbHZlOiB7XHJcbiAgICAgICAgYWxpYXM6IHtcclxuICAgICAgICAgICAgLy8gVXNhbW9zIHBhdGguam9pbiB5IHByb2Nlc3MuY3dkKCkgcGFyYSBldml0YXIgZXJyb3JlcyBjb24gZXNwYWNpb3MgZW4gV2luZG93c1xyXG4gICAgICAgICAgICAnQCc6IHBhdGguam9pbihwcm9jZXNzLmN3ZCgpLCAnc3JjJyksXHJcbiAgICAgICAgfSxcclxuICAgICAgICBleHRlbnNpb25zOiBbJy5tanMnLCAnLmpzJywgJy50cycsICcuanN4JywgJy50c3gnLCAnLmpzb24nXVxyXG4gICAgfSxcclxuICAgIG9wdGltaXplRGVwczoge1xyXG4gICAgICAgIGluY2x1ZGU6IFtcclxuICAgICAgICAgICAgJ2Nsc3gnLFxyXG4gICAgICAgICAgICAndGFpbHdpbmQtbWVyZ2UnLFxyXG4gICAgICAgICAgICAnY2xhc3MtdmFyaWFuY2UtYXV0aG9yaXR5JyxcclxuICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1sYWJlbCcsXHJcbiAgICAgICAgICAgICdAcmFkaXgtdWkvcmVhY3Qtc2xvdCcsXHJcbiAgICAgICAgICAgICdAcmFkaXgtdWkvcmVhY3QtcG9wb3ZlcicsXHJcbiAgICAgICAgICAgICdAcmFkaXgtdWkvcmVhY3QtZGlhbG9nJyxcclxuICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1zY3JvbGwtYXJlYScsXHJcbiAgICAgICAgICAgICdAcmFkaXgtdWkvcmVhY3QtYXZhdGFyJyxcclxuICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC10YWJzJyxcclxuICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1zZWxlY3QnLFxyXG4gICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LWRyb3Bkb3duLW1lbnUnLFxyXG4gICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LWFsZXJ0LWRpYWxvZycsXHJcbiAgICAgICAgICAgICdsdWNpZGUtcmVhY3QnLFxyXG4gICAgICAgICAgICAnZGF0ZS1mbnMnLFxyXG4gICAgICAgICAgICAnQHN1cGFiYXNlL3N1cGFiYXNlLWpzJyxcclxuICAgICAgICAgICAgJ2xlYWZsZXQnLFxyXG4gICAgICAgICAgICAncmVhY3QtbGVhZmxldCcsXHJcbiAgICAgICAgICAgICdsZWFmbGV0LWRlZmF1bHRpY29uLWNvbXBhdGliaWxpdHknLFxyXG4gICAgICAgICAgICAnc29ubmVyJ1xyXG4gICAgICAgIF0sXHJcbiAgICB9LFxyXG4gICAgYnVpbGQ6IHtcclxuICAgICAgICBjaHVua1NpemVXYXJuaW5nTGltaXQ6IDE2MDAsXHJcbiAgICAgICAgcm9sbHVwT3B0aW9uczoge1xyXG4gICAgICAgICAgICBvdXRwdXQ6IHtcclxuICAgICAgICAgICAgICAgIG1hbnVhbENodW5rczoge1xyXG4gICAgICAgICAgICAgICAgICAgICdyZWFjdC12ZW5kb3InOiBbJ3JlYWN0JywgJ3JlYWN0LWRvbScsICdyZWFjdC1yb3V0ZXItZG9tJ10sXHJcbiAgICAgICAgICAgICAgICAgICAgJ3VpLXZlbmRvcic6IFsnbHVjaWRlLXJlYWN0JywgJ2NsYXNzLXZhcmlhbmNlLWF1dGhvcml0eScsICd0YWlsd2luZC1tZXJnZSddLFxyXG4gICAgICAgICAgICAgICAgICAgICdyYWRpeCc6IFtcclxuICAgICAgICAgICAgICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1sYWJlbCcsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICdAcmFkaXgtdWkvcmVhY3Qtc2xvdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICdAcmFkaXgtdWkvcmVhY3QtcG9wb3ZlcicsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICdAcmFkaXgtdWkvcmVhY3QtZGlhbG9nJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1zY3JvbGwtYXJlYScsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICdAcmFkaXgtdWkvcmVhY3QtYXZhdGFyJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC10YWJzJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1zZWxlY3QnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LWRyb3Bkb3duLW1lbnUnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LWFsZXJ0LWRpYWxvZydcclxuICAgICAgICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgICAgICAgICdtYXBzJzogWydsZWFmbGV0JywgJ3JlYWN0LWxlYWZsZXQnLCAnbGVhZmxldC1kZWZhdWx0aWNvbi1jb21wYXRpYmlsaXR5J10sXHJcbiAgICAgICAgICAgICAgICAgICAgJ3N1cGFiYXNlJzogWydAc3VwYWJhc2Uvc3VwYWJhc2UtanMnXSxcclxuICAgICAgICAgICAgICAgICAgICAnZGF0ZSc6IFsnZGF0ZS1mbnMnXSxcclxuICAgICAgICAgICAgICAgICAgICAnbm90aWZ5JzogWydzb25uZXInXVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59KTtcclxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUErUCxTQUFTLG9CQUFvQjtBQUM1UixPQUFPLFdBQVc7QUFDbEIsT0FBTyxVQUFVO0FBQ2pCLE9BQU8saUJBQWlCO0FBQ3hCLE9BQU8sa0JBQWtCO0FBRXpCLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQ3hCLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxFQUNqQixLQUFLO0FBQUEsSUFDRCxTQUFTO0FBQUEsTUFDTCxTQUFTO0FBQUEsUUFDTCxZQUFZLHNCQUFzQjtBQUFBLFFBQ2xDO0FBQUEsTUFDSjtBQUFBLElBQ0o7QUFBQSxFQUNKO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDTCxPQUFPO0FBQUE7QUFBQSxNQUVILEtBQUssS0FBSyxLQUFLLFFBQVEsSUFBSSxHQUFHLEtBQUs7QUFBQSxJQUN2QztBQUFBLElBQ0EsWUFBWSxDQUFDLFFBQVEsT0FBTyxPQUFPLFFBQVEsUUFBUSxPQUFPO0FBQUEsRUFDOUQ7QUFBQSxFQUNBLGNBQWM7QUFBQSxJQUNWLFNBQVM7QUFBQSxNQUNMO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLElBQ0o7QUFBQSxFQUNKO0FBQUEsRUFDQSxPQUFPO0FBQUEsSUFDSCx1QkFBdUI7QUFBQSxJQUN2QixlQUFlO0FBQUEsTUFDWCxRQUFRO0FBQUEsUUFDSixjQUFjO0FBQUEsVUFDVixnQkFBZ0IsQ0FBQyxTQUFTLGFBQWEsa0JBQWtCO0FBQUEsVUFDekQsYUFBYSxDQUFDLGdCQUFnQiw0QkFBNEIsZ0JBQWdCO0FBQUEsVUFDMUUsU0FBUztBQUFBLFlBQ0w7QUFBQSxZQUNBO0FBQUEsWUFDQTtBQUFBLFlBQ0E7QUFBQSxZQUNBO0FBQUEsWUFDQTtBQUFBLFlBQ0E7QUFBQSxZQUNBO0FBQUEsWUFDQTtBQUFBLFlBQ0E7QUFBQSxVQUNKO0FBQUEsVUFDQSxRQUFRLENBQUMsV0FBVyxpQkFBaUIsbUNBQW1DO0FBQUEsVUFDeEUsWUFBWSxDQUFDLHVCQUF1QjtBQUFBLFVBQ3BDLFFBQVEsQ0FBQyxVQUFVO0FBQUEsVUFDbkIsVUFBVSxDQUFDLFFBQVE7QUFBQSxRQUN2QjtBQUFBLE1BQ0o7QUFBQSxJQUNKO0FBQUEsRUFDSjtBQUNKLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
