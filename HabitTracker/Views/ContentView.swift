import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: HabitStore
    @State private var isShowingAddHabit = false

    var body: some View {
        NavigationStack {
            Group {
                if store.habits.isEmpty {
                    ContentUnavailableView(
                        "Пока нет привычек",
                        systemImage: "checklist",
                        description: Text("Нажмите «+», чтобы добавить первую привычку")
                    )
                } else {
                    List {
                        ForEach(store.habits) { habit in
                            HabitRowView(habit: habit)
                        }
                        .onDelete { indexSet in
                            for index in indexSet {
                                store.deleteHabit(store.habits[index])
                            }
                        }
                    }
                }
            }
            .navigationTitle("Привычки")
            .toolbar {
                ToolbarItem {
                    Button(action: { isShowingAddHabit = true }) {
                        Label("Добавить привычку", systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $isShowingAddHabit) {
                AddHabitView()
            }
        }
        .frame(minWidth: 420, minHeight: 480)
    }
}

#Preview {
    ContentView()
        .environmentObject(HabitStore())
}
