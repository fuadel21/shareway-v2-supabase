import { Outlet, useParams } from 'react-router-dom';
import ConversationsList from './ConversationsList';
import { cn } from '@/lib/utils';

function ChatLayout() {
    const { chatId } = useParams();

    return (
        <div className="h-screen w-full flex bg-gray-100">
            <aside className={cn(
                "h-full w-full md:w-2/5 lg:w-1/3 xl:w-1/4 border-r bg-white transition-transform duration-300 ease-in-out",
                chatId && 'hidden md:flex' // Oculta la lista en móvil cuando un chat está abierto
            )}>
                <ConversationsList />
            </aside>
            <main className={cn(
                "h-full flex-1 transition-transform duration-300 ease-in-out",
                !chatId && 'hidden md:flex' // Oculta la ventana de chat en móvil si no hay chat abierto
            )}>
                <Outlet />
            </main>
        </div>
    );
}

export default ChatLayout;
