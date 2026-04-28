// vite.config.js
import { defineConfig } from "file:///C:/shareway%20v2%20supabase/node_modules/.pnpm/vite@5.4.21_@types+node@25.0.3/node_modules/vite/dist/node/index.js";
import react from "file:///C:/shareway%20v2%20supabase/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@5.4.21_@types+node@25.0.3_/node_modules/@vitejs/plugin-react/dist/index.js";
import path from "path";
import tailwindcss from "file:///C:/shareway%20v2%20supabase/node_modules/.pnpm/tailwindcss@3.4.19/node_modules/tailwindcss/lib/index.js";
import autoprefixer from "file:///C:/shareway%20v2%20supabase/node_modules/.pnpm/autoprefixer@10.4.23_postcss@8.5.6/node_modules/autoprefixer/lib/autoprefixer.js";
var vite_config_default = defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      protocol: "ws",
      host: "localhost",
      port: 5173
    }
  },
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxzaGFyZXdheSB2MiBzdXBhYmFzZVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiQzpcXFxcc2hhcmV3YXkgdjIgc3VwYWJhc2VcXFxcdml0ZS5jb25maWcuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0M6L3NoYXJld2F5JTIwdjIlMjBzdXBhYmFzZS92aXRlLmNvbmZpZy5qc1wiO2ltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGUnO1xyXG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xyXG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcclxuaW1wb3J0IHRhaWx3aW5kY3NzIGZyb20gJ3RhaWx3aW5kY3NzJztcclxuaW1wb3J0IGF1dG9wcmVmaXhlciBmcm9tICdhdXRvcHJlZml4ZXInO1xyXG5cclxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcclxuICAgIHBsdWdpbnM6IFtyZWFjdCgpXSxcclxuICAgIHNlcnZlcjoge1xyXG4gICAgICAgIHBvcnQ6IDUxNzMsXHJcbiAgICAgICAgc3RyaWN0UG9ydDogdHJ1ZSxcclxuICAgICAgICBobXI6IHtcclxuICAgICAgICAgICAgcHJvdG9jb2w6ICd3cycsXHJcbiAgICAgICAgICAgIGhvc3Q6ICdsb2NhbGhvc3QnLFxyXG4gICAgICAgICAgICBwb3J0OiA1MTczLFxyXG4gICAgICAgIH0sXHJcbiAgICB9LFxyXG4gICAgY3NzOiB7XHJcbiAgICAgICAgcG9zdGNzczoge1xyXG4gICAgICAgICAgICBwbHVnaW5zOiBbXHJcbiAgICAgICAgICAgICAgICB0YWlsd2luZGNzcygnLi90YWlsd2luZC5jb25maWcuanMnKSxcclxuICAgICAgICAgICAgICAgIGF1dG9wcmVmaXhlcixcclxuICAgICAgICAgICAgXSxcclxuICAgICAgICB9LFxyXG4gICAgfSxcclxuICAgIHJlc29sdmU6IHtcclxuICAgICAgICBhbGlhczoge1xyXG4gICAgICAgICAgICAvLyBVc2Ftb3MgcGF0aC5qb2luIHkgcHJvY2Vzcy5jd2QoKSBwYXJhIGV2aXRhciBlcnJvcmVzIGNvbiBlc3BhY2lvcyBlbiBXaW5kb3dzXHJcbiAgICAgICAgICAgICdAJzogcGF0aC5qb2luKHByb2Nlc3MuY3dkKCksICdzcmMnKSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIGV4dGVuc2lvbnM6IFsnLm1qcycsICcuanMnLCAnLnRzJywgJy5qc3gnLCAnLnRzeCcsICcuanNvbiddXHJcbiAgICB9LFxyXG4gICAgb3B0aW1pemVEZXBzOiB7XHJcbiAgICAgICAgaW5jbHVkZTogW1xyXG4gICAgICAgICAgICAnY2xzeCcsXHJcbiAgICAgICAgICAgICd0YWlsd2luZC1tZXJnZScsXHJcbiAgICAgICAgICAgICdjbGFzcy12YXJpYW5jZS1hdXRob3JpdHknLFxyXG4gICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LWxhYmVsJyxcclxuICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1zbG90JyxcclxuICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1wb3BvdmVyJyxcclxuICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1kaWFsb2cnLFxyXG4gICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LXNjcm9sbC1hcmVhJyxcclxuICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1hdmF0YXInLFxyXG4gICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LXRhYnMnLFxyXG4gICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LXNlbGVjdCcsXHJcbiAgICAgICAgICAgICdAcmFkaXgtdWkvcmVhY3QtZHJvcGRvd24tbWVudScsXHJcbiAgICAgICAgICAgICdAcmFkaXgtdWkvcmVhY3QtYWxlcnQtZGlhbG9nJyxcclxuICAgICAgICAgICAgJ2x1Y2lkZS1yZWFjdCcsXHJcbiAgICAgICAgICAgICdkYXRlLWZucycsXHJcbiAgICAgICAgICAgICdAc3VwYWJhc2Uvc3VwYWJhc2UtanMnLFxyXG4gICAgICAgICAgICAnbGVhZmxldCcsXHJcbiAgICAgICAgICAgICdyZWFjdC1sZWFmbGV0JyxcclxuICAgICAgICAgICAgJ2xlYWZsZXQtZGVmYXVsdGljb24tY29tcGF0aWJpbGl0eScsXHJcbiAgICAgICAgICAgICdzb25uZXInXHJcbiAgICAgICAgXSxcclxuICAgIH0sXHJcbiAgICBidWlsZDoge1xyXG4gICAgICAgIGNodW5rU2l6ZVdhcm5pbmdMaW1pdDogMTYwMCxcclxuICAgICAgICByb2xsdXBPcHRpb25zOiB7XHJcbiAgICAgICAgICAgIG91dHB1dDoge1xyXG4gICAgICAgICAgICAgICAgbWFudWFsQ2h1bmtzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgJ3JlYWN0LXZlbmRvcic6IFsncmVhY3QnLCAncmVhY3QtZG9tJywgJ3JlYWN0LXJvdXRlci1kb20nXSxcclxuICAgICAgICAgICAgICAgICAgICAndWktdmVuZG9yJzogWydsdWNpZGUtcmVhY3QnLCAnY2xhc3MtdmFyaWFuY2UtYXV0aG9yaXR5JywgJ3RhaWx3aW5kLW1lcmdlJ10sXHJcbiAgICAgICAgICAgICAgICAgICAgJ3JhZGl4JzogW1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LWxhYmVsJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1zbG90JyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1wb3BvdmVyJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1kaWFsb2cnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LXNjcm9sbC1hcmVhJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1hdmF0YXInLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LXRhYnMnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LXNlbGVjdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICdAcmFkaXgtdWkvcmVhY3QtZHJvcGRvd24tbWVudScsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICdAcmFkaXgtdWkvcmVhY3QtYWxlcnQtZGlhbG9nJ1xyXG4gICAgICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICAgICAgJ21hcHMnOiBbJ2xlYWZsZXQnLCAncmVhY3QtbGVhZmxldCcsICdsZWFmbGV0LWRlZmF1bHRpY29uLWNvbXBhdGliaWxpdHknXSxcclxuICAgICAgICAgICAgICAgICAgICAnc3VwYWJhc2UnOiBbJ0BzdXBhYmFzZS9zdXBhYmFzZS1qcyddLFxyXG4gICAgICAgICAgICAgICAgICAgICdkYXRlJzogWydkYXRlLWZucyddLFxyXG4gICAgICAgICAgICAgICAgICAgICdub3RpZnknOiBbJ3Nvbm5lciddXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbn0pO1xyXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQStQLFNBQVMsb0JBQW9CO0FBQzVSLE9BQU8sV0FBVztBQUNsQixPQUFPLFVBQVU7QUFDakIsT0FBTyxpQkFBaUI7QUFDeEIsT0FBTyxrQkFBa0I7QUFFekIsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDeEIsU0FBUyxDQUFDLE1BQU0sQ0FBQztBQUFBLEVBQ2pCLFFBQVE7QUFBQSxJQUNKLE1BQU07QUFBQSxJQUNOLFlBQVk7QUFBQSxJQUNaLEtBQUs7QUFBQSxNQUNELFVBQVU7QUFBQSxNQUNWLE1BQU07QUFBQSxNQUNOLE1BQU07QUFBQSxJQUNWO0FBQUEsRUFDSjtBQUFBLEVBQ0EsS0FBSztBQUFBLElBQ0QsU0FBUztBQUFBLE1BQ0wsU0FBUztBQUFBLFFBQ0wsWUFBWSxzQkFBc0I7QUFBQSxRQUNsQztBQUFBLE1BQ0o7QUFBQSxJQUNKO0FBQUEsRUFDSjtBQUFBLEVBQ0EsU0FBUztBQUFBLElBQ0wsT0FBTztBQUFBO0FBQUEsTUFFSCxLQUFLLEtBQUssS0FBSyxRQUFRLElBQUksR0FBRyxLQUFLO0FBQUEsSUFDdkM7QUFBQSxJQUNBLFlBQVksQ0FBQyxRQUFRLE9BQU8sT0FBTyxRQUFRLFFBQVEsT0FBTztBQUFBLEVBQzlEO0FBQUEsRUFDQSxjQUFjO0FBQUEsSUFDVixTQUFTO0FBQUEsTUFDTDtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxJQUNKO0FBQUEsRUFDSjtBQUFBLEVBQ0EsT0FBTztBQUFBLElBQ0gsdUJBQXVCO0FBQUEsSUFDdkIsZUFBZTtBQUFBLE1BQ1gsUUFBUTtBQUFBLFFBQ0osY0FBYztBQUFBLFVBQ1YsZ0JBQWdCLENBQUMsU0FBUyxhQUFhLGtCQUFrQjtBQUFBLFVBQ3pELGFBQWEsQ0FBQyxnQkFBZ0IsNEJBQTRCLGdCQUFnQjtBQUFBLFVBQzFFLFNBQVM7QUFBQSxZQUNMO0FBQUEsWUFDQTtBQUFBLFlBQ0E7QUFBQSxZQUNBO0FBQUEsWUFDQTtBQUFBLFlBQ0E7QUFBQSxZQUNBO0FBQUEsWUFDQTtBQUFBLFlBQ0E7QUFBQSxZQUNBO0FBQUEsVUFDSjtBQUFBLFVBQ0EsUUFBUSxDQUFDLFdBQVcsaUJBQWlCLG1DQUFtQztBQUFBLFVBQ3hFLFlBQVksQ0FBQyx1QkFBdUI7QUFBQSxVQUNwQyxRQUFRLENBQUMsVUFBVTtBQUFBLFVBQ25CLFVBQVUsQ0FBQyxRQUFRO0FBQUEsUUFDdkI7QUFBQSxNQUNKO0FBQUEsSUFDSjtBQUFBLEVBQ0o7QUFDSixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
