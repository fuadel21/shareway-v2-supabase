// vite.config.js
import { defineConfig } from "file:///C:/shareway%20v2%20supabase/node_modules/.pnpm/vite@5.4.21_@types+node@25.0.3/node_modules/vite/dist/node/index.js";
import react from "file:///C:/shareway%20v2%20supabase/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@5.4.21_@types+node@25.0.3_/node_modules/@vitejs/plugin-react/dist/index.js";
import path from "path";
import tailwindcss from "file:///C:/shareway%20v2%20supabase/node_modules/.pnpm/tailwindcss@3.4.19/node_modules/tailwindcss/lib/index.js";
import autoprefixer from "file:///C:/shareway%20v2%20supabase/node_modules/.pnpm/autoprefixer@10.4.23_postcss@8.5.6/node_modules/autoprefixer/lib/autoprefixer.js";
var __vite_injected_original_dirname = "C:\\shareway v2 supabase";
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
      "@": path.resolve(__vite_injected_original_dirname, "./src")
    }
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
      "sonner",
      "clsx",
      "tailwind-merge"
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
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    globals: true,
    testTimeout: 2e4,
    // 20 seconds for integration tests with auth
    include: ["src/**/*.test.{js,jsx,ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**"],
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/**", "src/test/**", "e2e/**"]
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxzaGFyZXdheSB2MiBzdXBhYmFzZVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiQzpcXFxcc2hhcmV3YXkgdjIgc3VwYWJhc2VcXFxcdml0ZS5jb25maWcuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0M6L3NoYXJld2F5JTIwdjIlMjBzdXBhYmFzZS92aXRlLmNvbmZpZy5qc1wiO2ltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGUnO1xyXG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xyXG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcclxuaW1wb3J0IHRhaWx3aW5kY3NzIGZyb20gJ3RhaWx3aW5kY3NzJztcclxuaW1wb3J0IGF1dG9wcmVmaXhlciBmcm9tICdhdXRvcHJlZml4ZXInO1xyXG5cclxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cclxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcclxuICAgIHBsdWdpbnM6IFtyZWFjdCgpXSxcclxuICAgIGNzczoge1xyXG4gICAgICAgIHBvc3Rjc3M6IHtcclxuICAgICAgICAgICAgcGx1Z2luczogW1xyXG4gICAgICAgICAgICAgICAgdGFpbHdpbmRjc3MoJy4vdGFpbHdpbmQuY29uZmlnLmpzJyksXHJcbiAgICAgICAgICAgICAgICBhdXRvcHJlZml4ZXIsXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgfSxcclxuICAgIH0sXHJcbiAgICByZXNvbHZlOiB7XHJcbiAgICAgICAgYWxpYXM6IHtcclxuICAgICAgICAgICAgJ0AnOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi9zcmMnKSxcclxuICAgICAgICB9LFxyXG4gICAgfSxcclxuICAgIG9wdGltaXplRGVwczoge1xyXG4gICAgICAgIGluY2x1ZGU6IFtcclxuICAgICAgICAgICAgJ2Nsc3gnLFxyXG4gICAgICAgICAgICAndGFpbHdpbmQtbWVyZ2UnLFxyXG4gICAgICAgICAgICAnY2xhc3MtdmFyaWFuY2UtYXV0aG9yaXR5JyxcclxuICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1sYWJlbCcsXHJcbiAgICAgICAgICAgICdAcmFkaXgtdWkvcmVhY3Qtc2xvdCcsXHJcbiAgICAgICAgICAgICdAcmFkaXgtdWkvcmVhY3QtcG9wb3ZlcicsXHJcbiAgICAgICAgICAgICdAcmFkaXgtdWkvcmVhY3QtZGlhbG9nJyxcclxuICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1zY3JvbGwtYXJlYScsXHJcbiAgICAgICAgICAgICdAcmFkaXgtdWkvcmVhY3QtYXZhdGFyJyxcclxuICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC10YWJzJyxcclxuICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1zZWxlY3QnLFxyXG4gICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LWRyb3Bkb3duLW1lbnUnLFxyXG4gICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LWFsZXJ0LWRpYWxvZycsXHJcbiAgICAgICAgICAgICdsdWNpZGUtcmVhY3QnLFxyXG4gICAgICAgICAgICAnZGF0ZS1mbnMnLFxyXG4gICAgICAgICAgICAnQHN1cGFiYXNlL3N1cGFiYXNlLWpzJyxcclxuICAgICAgICAgICAgJ2xlYWZsZXQnLFxyXG4gICAgICAgICAgICAncmVhY3QtbGVhZmxldCcsXHJcbiAgICAgICAgICAgICdsZWFmbGV0LWRlZmF1bHRpY29uLWNvbXBhdGliaWxpdHknLFxyXG4gICAgICAgICAgICAnc29ubmVyJyxcclxuICAgICAgICAgICAgJ2Nsc3gnLFxyXG4gICAgICAgICAgICAndGFpbHdpbmQtbWVyZ2UnXHJcbiAgICAgICAgXSxcclxuICAgIH0sXHJcbiAgICBidWlsZDoge1xyXG4gICAgICAgIGNodW5rU2l6ZVdhcm5pbmdMaW1pdDogMTYwMCxcclxuICAgICAgICByb2xsdXBPcHRpb25zOiB7XHJcbiAgICAgICAgICAgIG91dHB1dDoge1xyXG4gICAgICAgICAgICAgICAgbWFudWFsQ2h1bmtzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgJ3JlYWN0LXZlbmRvcic6IFsncmVhY3QnLCAncmVhY3QtZG9tJywgJ3JlYWN0LXJvdXRlci1kb20nXSxcclxuICAgICAgICAgICAgICAgICAgICAndWktdmVuZG9yJzogWydsdWNpZGUtcmVhY3QnLCAnY2xhc3MtdmFyaWFuY2UtYXV0aG9yaXR5JywgJ3RhaWx3aW5kLW1lcmdlJ10sXHJcbiAgICAgICAgICAgICAgICAgICAgJ3JhZGl4JzogW1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LWxhYmVsJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1zbG90JyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1wb3BvdmVyJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1kaWFsb2cnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LXNjcm9sbC1hcmVhJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1hdmF0YXInLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LXRhYnMnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LXNlbGVjdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICdAcmFkaXgtdWkvcmVhY3QtZHJvcGRvd24tbWVudScsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICdAcmFkaXgtdWkvcmVhY3QtYWxlcnQtZGlhbG9nJ1xyXG4gICAgICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICAgICAgJ21hcHMnOiBbJ2xlYWZsZXQnLCAncmVhY3QtbGVhZmxldCcsICdsZWFmbGV0LWRlZmF1bHRpY29uLWNvbXBhdGliaWxpdHknXSxcclxuICAgICAgICAgICAgICAgICAgICAnc3VwYWJhc2UnOiBbJ0BzdXBhYmFzZS9zdXBhYmFzZS1qcyddLFxyXG4gICAgICAgICAgICAgICAgICAgICdkYXRlJzogWydkYXRlLWZucyddLFxyXG4gICAgICAgICAgICAgICAgICAgICdub3RpZnknOiBbJ3Nvbm5lciddXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9LFxyXG4gICAgdGVzdDoge1xyXG4gICAgICAgIGVudmlyb25tZW50OiAnanNkb20nLFxyXG4gICAgICAgIHNldHVwRmlsZXM6IFsnc3JjL3Rlc3Qvc2V0dXAudHMnXSxcclxuICAgICAgICBnbG9iYWxzOiB0cnVlLFxyXG4gICAgICAgIHRlc3RUaW1lb3V0OiAyMDAwMCwgLy8gMjAgc2Vjb25kcyBmb3IgaW50ZWdyYXRpb24gdGVzdHMgd2l0aCBhdXRoXHJcbiAgICAgICAgaW5jbHVkZTogWydzcmMvKiovKi50ZXN0Lntqcyxqc3gsdHMsdHN4fSddLFxyXG4gICAgICAgIGV4Y2x1ZGU6IFsnZTJlLyoqJywgJ25vZGVfbW9kdWxlcy8qKiddLFxyXG4gICAgICAgIGZpbGVQYXJhbGxlbGlzbTogZmFsc2UsXHJcbiAgICAgICAgcG9vbDogJ2ZvcmtzJyxcclxuICAgICAgICBwb29sT3B0aW9uczoge1xyXG4gICAgICAgICAgICBmb3Jrczoge1xyXG4gICAgICAgICAgICAgICAgc2luZ2xlRm9yazogdHJ1ZSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIGNvdmVyYWdlOiB7XHJcbiAgICAgICAgICAgIHByb3ZpZGVyOiAndjgnLFxyXG4gICAgICAgICAgICByZXBvcnRlcjogWyd0ZXh0JywgJ2pzb24nLCAnaHRtbCddLFxyXG4gICAgICAgICAgICBleGNsdWRlOiBbJ25vZGVfbW9kdWxlcy8qKicsICdzcmMvdGVzdC8qKicsICdlMmUvKionXVxyXG4gICAgICAgIH1cclxuICAgIH1cclxufSk7XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBK1AsU0FBUyxvQkFBb0I7QUFDNVIsT0FBTyxXQUFXO0FBQ2xCLE9BQU8sVUFBVTtBQUNqQixPQUFPLGlCQUFpQjtBQUN4QixPQUFPLGtCQUFrQjtBQUp6QixJQUFNLG1DQUFtQztBQU96QyxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUN4QixTQUFTLENBQUMsTUFBTSxDQUFDO0FBQUEsRUFDakIsS0FBSztBQUFBLElBQ0QsU0FBUztBQUFBLE1BQ0wsU0FBUztBQUFBLFFBQ0wsWUFBWSxzQkFBc0I7QUFBQSxRQUNsQztBQUFBLE1BQ0o7QUFBQSxJQUNKO0FBQUEsRUFDSjtBQUFBLEVBQ0EsU0FBUztBQUFBLElBQ0wsT0FBTztBQUFBLE1BQ0gsS0FBSyxLQUFLLFFBQVEsa0NBQVcsT0FBTztBQUFBLElBQ3hDO0FBQUEsRUFDSjtBQUFBLEVBQ0EsY0FBYztBQUFBLElBQ1YsU0FBUztBQUFBLE1BQ0w7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxJQUNKO0FBQUEsRUFDSjtBQUFBLEVBQ0EsT0FBTztBQUFBLElBQ0gsdUJBQXVCO0FBQUEsSUFDdkIsZUFBZTtBQUFBLE1BQ1gsUUFBUTtBQUFBLFFBQ0osY0FBYztBQUFBLFVBQ1YsZ0JBQWdCLENBQUMsU0FBUyxhQUFhLGtCQUFrQjtBQUFBLFVBQ3pELGFBQWEsQ0FBQyxnQkFBZ0IsNEJBQTRCLGdCQUFnQjtBQUFBLFVBQzFFLFNBQVM7QUFBQSxZQUNMO0FBQUEsWUFDQTtBQUFBLFlBQ0E7QUFBQSxZQUNBO0FBQUEsWUFDQTtBQUFBLFlBQ0E7QUFBQSxZQUNBO0FBQUEsWUFDQTtBQUFBLFlBQ0E7QUFBQSxZQUNBO0FBQUEsVUFDSjtBQUFBLFVBQ0EsUUFBUSxDQUFDLFdBQVcsaUJBQWlCLG1DQUFtQztBQUFBLFVBQ3hFLFlBQVksQ0FBQyx1QkFBdUI7QUFBQSxVQUNwQyxRQUFRLENBQUMsVUFBVTtBQUFBLFVBQ25CLFVBQVUsQ0FBQyxRQUFRO0FBQUEsUUFDdkI7QUFBQSxNQUNKO0FBQUEsSUFDSjtBQUFBLEVBQ0o7QUFBQSxFQUNBLE1BQU07QUFBQSxJQUNGLGFBQWE7QUFBQSxJQUNiLFlBQVksQ0FBQyxtQkFBbUI7QUFBQSxJQUNoQyxTQUFTO0FBQUEsSUFDVCxhQUFhO0FBQUE7QUFBQSxJQUNiLFNBQVMsQ0FBQywrQkFBK0I7QUFBQSxJQUN6QyxTQUFTLENBQUMsVUFBVSxpQkFBaUI7QUFBQSxJQUNyQyxpQkFBaUI7QUFBQSxJQUNqQixNQUFNO0FBQUEsSUFDTixhQUFhO0FBQUEsTUFDVCxPQUFPO0FBQUEsUUFDSCxZQUFZO0FBQUEsTUFDaEI7QUFBQSxJQUNKO0FBQUEsSUFDQSxVQUFVO0FBQUEsTUFDTixVQUFVO0FBQUEsTUFDVixVQUFVLENBQUMsUUFBUSxRQUFRLE1BQU07QUFBQSxNQUNqQyxTQUFTLENBQUMsbUJBQW1CLGVBQWUsUUFBUTtBQUFBLElBQ3hEO0FBQUEsRUFDSjtBQUNKLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
