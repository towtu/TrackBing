// src/styles/AddFoodStyles.ts
import { StyleSheet, Platform } from 'react-native';
import { Colors } from './colors';

export const AddFoodStyles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: Colors.secondary, 
    alignItems: 'center' 
  },
  contentContainer: {
    flex: 1,
    width: '100%',
    maxWidth: 600, 
    padding: 16,
  },
  searchBox: { 
    flexDirection: 'row', 
    gap: 10, 
    marginBottom: 20 
  },
  input: { 
    flex: 1, 
    backgroundColor: Colors.white, 
    padding: 12, 
    borderRadius: 8, 
    borderWidth: 1, 
    borderColor: Colors.border,
    fontSize: 16,
  },
  searchBtn: { 
    backgroundColor: Colors.primary, // Black Button
    paddingVertical: 12,
    paddingHorizontal: 20, 
    borderRadius: 8, 
    justifyContent: 'center' 
  },
  btnText: { 
    color: Colors.textOnPrimary, // White Text
    fontWeight: 'bold' 
  },
  itemCard: { 
    flexDirection: 'row', 
    backgroundColor: Colors.white, 
    padding: 16, 
    borderRadius: 12, 
    marginBottom: 10, 
    alignItems: 'center',
    // Shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  itemName: { 
    fontSize: 16, 
    fontWeight: '600', 
    color: Colors.text 
  },
  itemSub: { 
    color: Colors.textSecondary, 
    marginTop: 4 
  },
  addBtn: { 
    backgroundColor: Colors.accent, // Yellow Button (Minimal Pop)
    width: 40, 
    height: 40, 
    borderRadius: 20, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  addBtnText: { 
    color: Colors.textOnAccent, // Black Text (on Yellow)
    fontSize: 24, 
    fontWeight: 'bold',
    marginTop: -2 // Visual tweak to center the +
  }
});